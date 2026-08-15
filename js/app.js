/**
 * app.js — Methoryn SiteAgent chat UI.
 * Sidebar chats · streaming multi-provider replies · BYOK settings.
 */
(function () {
  "use strict";

  var St = window.MethorynStorage;
  var Pr = window.MethorynProviders;
  var Md = window.MethorynMarkdown;

  var ACTIVE_DB = "methoryn_siteagent_active_chat";

  var S = {
    chats: St.loadChats(),
    activeId: localStorage.getItem(ACTIVE_DB) || null,
    provider: "groq",
    busy: false,
    controller: null,
  };

  // ── Element refs ─────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    chatList: $("chat-list"),
    newChat: $("new-chat"),
    settingsBtn: $("settings-btn"),
    layerStatus: $("layer-status"),
    chatTitle: $("chat-title"),
    providerSelect: $("provider-select"),
    busyLabel: $("busy-label"),
    messages: $("messages"),
    input: $("input"),
    sendBtn: $("send-btn"),
    stopBtn: $("stop-btn"),
    modal: $("settings-modal"),
    modalClose: $("settings-close"),
    modalDone: $("settings-done"),
    keysForm: $("keys-form"),
    settingsStatus: $("settings-status"),
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    el.modal.hidden = true;
    renderProviderSelect();
    renderLayerStatus();
    bindEvents();

    if (S.activeId && St.getChat(S.activeId)) {
      selectChat(S.activeId);
    } else {
      renderWelcome();
    }
  }

  // ── Sidebar: provider select + layer status ──────────────────────────────

  function renderProviderSelect() {
    var html = "";
    Object.keys(Pr.PROVIDERS).forEach(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      html += "<option value=\"" + key + "\">" + p.label + " — " + p.model +
        (cfg ? "" : "  (no key)") + "</option>";
    });
    el.providerSelect.innerHTML = html;
  }

  function renderLayerStatus() {
    var html = "";
    Object.keys(Pr.PROVIDERS).forEach(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      html += "<div class=\"layer-row " + (cfg ? "on" : "off") + "\">" +
        "<span class=\"dot\"></span>" +
        "<span class=\"name\">" + p.label + "</span>" +
        "<span>" + (cfg ? "key ✓" : "no key") + "</span>" +
        "</div>";
    });
    el.layerStatus.innerHTML = html;
  }

  function renderWelcome() {
    var cards = Object.keys(Pr.PROVIDERS).map(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      var state = cfg
        ? "<div class=\"state ready\">● configured</div>"
        : "<div class=\"state missing\">○ no key — add in Settings</div>";
      return "<div class=\"w-card\">" +
        "<div class=\"layer\">" + p.layer + "</div>" +
        "<div class=\"title\">" + p.label + " · " + p.model + "</div>" +
        state + "</div>";
    }).join("");

    el.messages.innerHTML =
      "<div class=\"welcome\">" +
        "<div class=\"w-logo\">◉ Methoryn</div>" +
        "<div class=\"w-tagline\">SiteAgent · one brain · many hands · full control</div>" +
        "<div class=\"w-layers\">" + cards + "</div>" +
        "<div class=\"w-hint\">Pick a layer in the top bar and start chatting.</div>" +
      "</div>";
    el.chatTitle.textContent = "New chat";
  }

  // ── Chat list ────────────────────────────────────────────────────────────

  function renderChatList() {
    if (!S.chats.length) {
      el.chatList.innerHTML = "<div class=\"chat-empty\">No chats yet</div>";
      return;
    }
    var html = S.chats.map(function (c) {
      var cls = "chat-item" + (c.id === S.activeId ? " active" : "");
      return "<div class=\"" + cls + "\" data-id=\"" + c.id + "\">" +
        "<span class=\"chat-name\"></span>" +
        "<button class=\"del\" data-del=\"" + c.id + "\" title=\"Delete chat\">✕</button>" +
        "</div>";
    }).join("");
    el.chatList.innerHTML = html;

    // fill names as text nodes (after building, to keep them escaped)
    var items = el.chatList.querySelectorAll(".chat-item");
    S.chats.forEach(function (c, i) {
      if (items[i]) items[i].querySelector(".chat-name").textContent = c.title;
    });
  }

  function newChat() {
    var chat = St.createChat();
    S.chats = St.loadChats();
    S.activeId = chat.id;
    localStorage.setItem(ACTIVE_DB, chat.id);
    renderChatList();
    selectChat(chat.id);
    el.input.focus();
  }

  function selectChat(id) {
    var chat = St.getChat(id);
    if (!chat) return;
    S.activeId = id;
    localStorage.setItem(ACTIVE_DB, id);
    renderChatList();
    renderMessages();
    el.input.focus();
  }

  function deleteChat(id) {
    var wasActive = id === S.activeId;
    S.chats = St.deleteChat(id);
    if (wasActive) {
      S.activeId = S.chats.length ? S.chats[0].id : null;
      if (S.activeId) localStorage.setItem(ACTIVE_DB, S.activeId);
      else localStorage.removeItem(ACTIVE_DB);
    }
    renderChatList();
    if (S.activeId) renderMessages();
    else renderWelcome();
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  function activeChat() {
    return S.activeId ? St.getChat(S.activeId) : null;
  }

  function renderMessages() {
    var chat = activeChat();
    if (!chat) { renderWelcome(); return; }
    el.messages.innerHTML = "";
    el.chatTitle.textContent = chat.title;
    chat.messages.forEach(function (m) {
      var node = makeMessageEl(m.role);
      node.content.innerHTML = m.role === "assistant"
        ? Md.render(m.content)
        : Md.escapeHtml(m.content).replace(/\n/g, "<br>");
      if (m.role === "assistant" && m.providerLabel) {
        node.content.insertAdjacentHTML("beforeend",
          "<p class=\"provider-tag\">— via " + Md.escapeHtml(m.providerLabel) + "</p>");
      }
    });
    scrollBottom();
  }

  function makeMessageEl(role, extraClass) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + role + (extraClass ? " " + extraClass : "");
    wrap.innerHTML =
      "<div class=\"avatar\">" + (role === "user" ? "YOU" : "◉") + "</div>" +
      "<div class=\"body\">" +
        "<div class=\"role\">" + (role === "user" ? "You" : "Methoryn") + "</div>" +
        "<div class=\"content\"></div>" +
      "</div>";
    el.messages.appendChild(wrap);
    return { wrap: wrap, content: wrap.querySelector(".content") };
  }

  function scrollBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  function sendMessage() {
    if (S.busy) return;
    var text = el.input.value.trim();
    if (!text) return;

    if (!S.activeId || !St.getChat(S.activeId)) {
      newChat();
    }
    var chat = activeChat();

    var byok = St.loadByok();
    var p = Pr.PROVIDERS[S.provider];
    var apiKey = byok[p.keyName];

    if (!apiKey) {
      openSettings();
      flashStatus("Add your " + p.keyName + " in Settings to chat with " + p.label + ".");
      return;
    }

    // user message
    chat.messages.push({ role: "user", content: text });
    if (chat.title === "New chat") {
      chat.title = text.length > 40 ? text.slice(0, 40) + "…" : text;
    }
    St.updateChat(chat);

    el.input.value = "";
    autoResize();
    renderMessages();

    // assistant streaming element
    var node = makeMessageEl("assistant");
    node.content.innerHTML = "<span class=\"caret\">▍</span>";
    scrollBottom();

    setBusy(true);
    var accumulated = "";

    function onDelta(d) {
      accumulated += d;
      node.content.innerHTML = Md.render(accumulated) +
        "<span class=\"caret\">▍</span>";
      scrollBottom();
    }
    function onDone() {
      node.content.innerHTML = Md.render(accumulated);
      scrollBottom();
    }
    function onError(err) {
      node.content.innerHTML = "<span style=\"color:var(--danger)\">✗ " +
        Md.escapeHtml(String(err.message || err)) + "</span>";
      scrollBottom();
    }

    S.controller = new AbortController();
    var messages = Pr.buildMessages(chat.messages);

    p.stream({
      apiKey: apiKey,
      model: p.model,
      messages: messages,
      onDelta: onDelta,
      onDone: onDone,
      signal: S.controller.signal,
    }).then(function () {
      chat.messages.push({
        role: "assistant",
        content: accumulated,
        providerLabel: p.label,
      });
      chat.provider = p.key;
      chat.model = p.model;
      St.updateChat(chat);
      node.content.insertAdjacentHTML("beforeend",
        "<p class=\"provider-tag\">— via " + Md.escapeHtml(p.label) + "</p>");
    }).catch(function (err) {
      if (err.message === "aborted") {
        node.content.innerHTML = Md.render(accumulated) +
          "<p><span style=\"color:var(--text-muted)\">— stopped</span></p>";
        chat.messages.push({
          role: "assistant",
          content: accumulated + "\n\n— stopped",
          providerLabel: p.label,
        });
        chat.provider = p.key;
        St.updateChat(chat);
        node.content.insertAdjacentHTML("beforeend",
          "<p class=\"provider-tag\">— via " + Md.escapeHtml(p.label) + "</p>");
      } else {
        onError(err);
      }
    }).finally(function () {
      setBusy(false);
      renderChatList();
      el.input.focus();
    });
  }

  function stopMessage() {
    if (S.controller) S.controller.abort();
  }

  function setBusy(busy) {
    S.busy = busy;
    el.busyLabel.hidden = !busy;
    el.busyLabel.textContent = busy ? "working…" : "";
    el.sendBtn.hidden = busy;
    el.stopBtn.hidden = !busy;
  }

  // ── Settings (BYOK) ──────────────────────────────────────────────────────

  function openSettings() {
    try {
      renderKeysForm();
    } catch (err) {
      el.keysForm.innerHTML = "<p style=\"color:var(--danger)\">Could not load providers: " +
        Md.escapeHtml(String(err && err.message || err)) + "</p>";
    }
    el.modal.hidden = false;
  }

  function closeSettings() {
    el.modal.hidden = true;
    el.settingsStatus.textContent = "";
  }

  function renderKeysForm() {
    var html = Object.keys(Pr.PROVIDERS).map(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      return "<div class=\"key-row\" data-key=\"" + key + "\">" +
        "<div class=\"key-head\">" +
          "<span class=\"key-name\">" + p.keyName + "</span>" +
          "<span class=\"key-state " + (cfg ? "on" : "") + "\">" +
            (cfg ? "● saved" : "○ not set") + "</span>" +
        "</div>" +
        "<div class=\"layer-line\">" + p.layer + " · " + p.model + "</div>" +
        "<input type=\"password\" placeholder=\"" + (cfg ? "••••••••  (saved — type to replace)" : "Paste your " + p.keyName) + "\" autocomplete=\"off\">" +
        "<div class=\"key-actions\">" +
          "<button class=\"mini-btn save\">Save key</button>" +
          (cfg ? "<button class=\"mini-btn danger remove\">Remove</button>" : "") +
        "</div>" +
      "</div>";
    }).join("");
    el.keysForm.innerHTML = html;

    // Google workspace note
    var note = document.createElement("p");
    note.className = "modal-note";
    note.innerHTML = "<span style=\"color:var(--text-dim)\">Google Workspace (Gmail/Drive/Docs) uses OAuth via the CLI's credentials.json — a browser-only site cannot run that flow securely. " +
      "Your <b>GOOGLE_API_KEY</b> above still powers Gemini chat/research right here.</span>";
    el.keysForm.appendChild(note);
  }

  function flashStatus(msg) {
    el.settingsStatus.textContent = msg;
    setTimeout(function () { el.settingsStatus.textContent = ""; }, 3500);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function bindEvents() {
    el.newChat.addEventListener("click", newChat);

    el.chatList.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) { deleteChat(del.getAttribute("data-del")); return; }
      var item = e.target.closest(".chat-item");
      if (item) selectChat(item.getAttribute("data-id"));
    });

    el.settingsBtn.addEventListener("click", openSettings);
    el.modalClose.addEventListener("click", closeSettings);
    el.modalDone.addEventListener("click", closeSettings);
    el.modal.addEventListener("click", function (e) {
      if (e.target === el.modal) closeSettings();
    });

    el.keysForm.addEventListener("click", function (e) {
      var row = e.target.closest(".key-row");
      if (!row) return;
      var key = row.getAttribute("data-key");
      var p = Pr.PROVIDERS[key];
      var input = row.querySelector("input");
      if (e.target.closest(".save")) {
        var val = input.value.trim();
        if (!val) { flashStatus("Paste a key first."); return; }
        St.saveByokKey(p.keyName, val);
        flashStatus(p.keyName + " saved — active now.");
        renderKeysForm();
        renderLayerStatus();
        renderProviderSelect();
        if (S.activeId) renderMessages();
        else renderWelcome();
      } else if (e.target.closest(".remove")) {
        St.removeByokKey(p.keyName);
        flashStatus(p.keyName + " removed.");
        renderKeysForm();
        renderLayerStatus();
        renderProviderSelect();
        if (S.activeId) renderMessages();
        else renderWelcome();
      }
    });

    el.providerSelect.addEventListener("change", function () {
      S.provider = el.providerSelect.value;
      if (!Pr.isConfigured(S.provider)) {
        var p = Pr.PROVIDERS[S.provider];
        el.busyLabel.textContent = "no key for " + p.label;
        el.busyLabel.hidden = false;
        setTimeout(function () { if (!S.busy) el.busyLabel.hidden = true; }, 3000);
      }
    });

    el.sendBtn.addEventListener("click", sendMessage);
    el.stopBtn.addEventListener("click", stopMessage);

    el.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    el.input.addEventListener("input", autoResize);
  }

  function autoResize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
