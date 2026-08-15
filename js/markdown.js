/**
 * markdown.js — minimal, safe Markdown → HTML renderer.
 * Escapes all HTML first, so model output can never inject markup.
 */
(function () {
  "use strict";

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(text) {
    text = escapeHtml(text);

    // inline code (before bold/italic so * inside code is safe)
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

    // links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // bold
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    // strikethrough
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return text;
  }

  function renderBlock(md) {
    // split into lines, keep them for list/table detection
    var lines = md.replace(/\r\n/g, "\n").split("\n");
    var html = [];
    var i = 0;
    var inCode = false;
    var codeLang = "";
    var codeBuf = [];
    var inList = null;
    var inQuote = false;

    function flushList() {
      if (inList) { html.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
    }

    function flushQuote() {
      if (inQuote) { html.push("</blockquote>"); inQuote = false; }
    }

    for (; i < lines.length; i++) {
      var line = lines[i];

      // ── code fence ──
      var fence = /^```([\w+-]*)\s*$/.exec(line);
      if (fence) {
        if (inCode) {
          html.push("<pre><code>" + escapeHtml(codeBuf.join("\n")) + "</code></pre>");
          codeBuf = [];
          inCode = false;
        } else {
          flushList(); flushQuote();
          inCode = true;
          codeLang = fence[1] || "";
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      var trimmed = line.trim();

      if (trimmed === "") {
        flushList(); flushQuote();
        html.push("</p><p>");
        continue;
      }

      // ── heading ──
      var h = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (h) {
        flushList(); flushQuote();
        var lvl = h[1].length;
        html.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">");
        continue;
      }

      // ── horizontal rule ──
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushList(); flushQuote();
        html.push("<hr>");
        continue;
      }

      // ── blockquote ──
      var bq = /^>\s?(.*)$/.exec(trimmed);
      if (bq) {
        flushList();
        if (!inQuote) { html.push("<blockquote>"); inQuote = true; }
        html.push(inline(bq[1]) + "<br>");
        continue;
      }

      // ── list ──
      var ul = /^[-*+]\s+(.*)$/.exec(trimmed);
      if (ul) {
        flushQuote();
        if (inList !== "ul") {
          flushList();
          html.push("<ul>");
          inList = "ul";
        }
        html.push("<li>" + inline(ul[1]) + "</li>");
        continue;
      }
      var ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
      if (ol) {
        flushQuote();
        if (inList !== "ol") {
          flushList();
          html.push("<ol>");
          inList = "ol";
        }
        html.push("<li>" + inline(ol[1]) + "</li>");
        continue;
      }

      // ── table separator row ──
      if (inList) { flushList(); }

      // ── table: detect header | line + separator | line
      if (/^\|.*\|$/.test(trimmed) &&
          i + 1 < lines.length &&
          /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) &&
          lines[i + 1].indexOf("-") !== -1) {
        var headerCells = trimmed.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        var sepCells = lines[i + 1].replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
        var aligns = sepCells.map(function (c) {
          if (/^:.*:$/.test(c)) return ' style="text-align:center"';
          if (/^:/.test(c))     return ' style="text-align:left"';
          if (/:$/.test(c))     return ' style="text-align:right"';
          return "";
        });
        html.push("<table><thead><tr>");
        headerCells.forEach(function (c, idx) {
          html.push("<th" + aligns[idx] + ">" + inline(c) + "</th>");
        });
        html.push("</tr></thead><tbody>");
        i += 1; // skip separator
        // body rows
        while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1].trim())) {
          i += 1;
          var cells = lines[i].replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
          html.push("<tr>");
          cells.forEach(function (c, idx) {
            html.push("<td" + aligns[idx] + ">" + inline(c) + "</td>");
          });
          html.push("</tr>");
        }
        html.push("</tbody></table>");
        continue;
      }

      // ── plain paragraph line ──
      html.push(inline(trimmed) + "<br>");
    }

    if (inCode) { html.push("<pre><code>" + escapeHtml(codeBuf.join("\n")) + "</code></pre>"); }
    flushList(); flushQuote();

    return html.join("").replace(/<p><br>\s*<\/p>/g, "").replace(/<br><\/p>/g, "</p>");
  }

  function renderMarkdown(md) {
    if (!md) return "";
    return "<p>" + renderBlock(md) + "</p>";
  }

  window.MethorynMarkdown = { render: renderMarkdown, escapeHtml: escapeHtml };
})();
