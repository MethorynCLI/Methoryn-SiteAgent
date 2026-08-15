/**
 * app.js — Methoryn SiteAgent chat UI.
 * Groq-only chat (L1 orchestrator) · blocking setup gate · chat rename ·
 * BYOK settings with live key validation (mirrors the CLI).
 */
(function () {
  "use strict";

  var St = window.MethorynStorage;
  var Pr = window.MethorynProviders;
  var Md = window.MethorynMarkdown;

  var ACTIVE_DB = "methoryn_siteagent_active_chat";
  var CHAT_PROVIDER = "groq"; // the one agent you talk to — the CLI's L1

  var S = {
    chats: St.loadChats(),
    activeId: localStorage.getItem(ACTIVE_DB) || null,
    busy: false,
    controller: null,
    setupMode: false,
  };

  // ── Element refs ─────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    chatList: $("chat-list"),
    newChat: $("new-chat"),
    settingsBtn: $("settings-btn"),
    layerStatus: $("layer-status"),
    chatTitle: $("chat-title"),
    busyLabel: $("busy-label"),
    messages: $("messages"),
    input: $("input"),
    sendBtn: $("send-btn"),
    stopBtn: $("stop-btn"),
    modal: $("settings-modal"),
    modalClose: $("settings-close"),
    modalDone: $("settings-done"),
    modalNote: $("settings-note"),
    keysForm: $("keys-form"),
    settingsStatus: $("settings-status"),
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    el.modal.hidden = true;
    renderLayerStatus();
    bindEvents();

    if (S.activeId && St.getChat(S.activeId)) {
      selectChat(S.activeId);
    } else {
      renderWelcome();
    }

    // First-run gate, exactly like the CLI: no chat until every required
    // key (Layers 1–4) is configured and validated.
    if (!requiredReady()) openSettings();
  }

  // ── Setup gate helpers ───────────────────────────────────────────────────

  function validationFor(key) {
    return St.loadValidation()[key];
  }

  function requiredReady() {
    var all = true;
    Object.keys(Pr.PROVIDERS).forEach(function (key) {
      var p = Pr.PROVIDERS[key];
      if (!p.required) return;
      if (!Pr.isConfigured(key) || validationFor(key) !== "ok") all = false;
    });
    return all;
  }

  // ── Sidebar: agent layer status ──────────────────────────────────────────

  function renderLayerStatus() {
    var html = "";
    Object.keys(Pr.PROVIDERS).forEach(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      var v = validationFor(key);
      var ok = cfg && (v === "ok" || !p.required);
      var text = !cfg ? "no key"
        : v === "ok" ? "valid ✓"
        : v === "fail" ? "invalid ✗"
        : "saved";
      html += "<div class=\"layer-row " + (ok ? "on" : "off") + "\">" +
        "<span class=\"dot\"></span>" +
        "<span class=\"name\">" + p.label + "</span>" +
        "<span>" + text + "</span>" +
        "</div>";
    });
    el.layerStatus.innerHTML = html;
  }

  // ── Welcome ──────────────────────────────────────────────────────────────

  function renderWelcome() {
    var cards = Object.keys(Pr.PROVIDERS).map(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      var v = validationFor(key);
      var state;
      if (!cfg) state = "<div class=\"state missing\">○ no key — add in Settings</div>";
      else if (v === "fail") state = "<div class=\"state missing\">✗ key invalid</div>";
      else if (v === "ok" || !p.required) state = "<div class=\"state ready\">● configured</div>";
      else state = "<div class=\"state missing\">○ key saved — not validated</div>";
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
        "<div class=\"w-hint\">You chat with L1 Groq — the full five-layer stack stays configured behind it.</div>" +
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
        "<span class=\"chat-actions\">" +
          "<button class=\"rename\" data-rename=\"" + c.id + "\" title=\"Rename chat\">✎</button>" +
          "<button class=\"del\" data-del=\"" + c.id + "\" title=\"Delete chat\">✕</button>" +
        "</span>" +
        "</div>";
    }).join("");
    el.chatList.innerHTML = html;

    // fill names as text nodes (after building, to keep them escaped)
    var items = el.chatList.querySelectorAll(".chat-item");
    S.chats.forEach(function (c, i) {
      if (items[i]) items[i].querySelector(".chat-name").textContent = c.title;
    });
  }

  function startRename(id) {
    var item = el.chatList.querySelector('.chat-item[data-id="' + id + '"]');
    if (!item) return;
    var name = item.querySelector(".chat-name");
    if (!name) return;
    var input = document.createElement("input");
    input.className = "rename-input";
    input.value = name.textContent;
    input.maxLength = 60;
    name.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function commit() {
      if (done) return;
      done = true;
      var title = input.value.trim();
      var chat = St.getChat(id);
      if (chat) {
        if (title && title !== chat.title) {
          chat.title = title;
          St.updateChat(chat);
        }
        S.chats = St.loadChats();
        renderChatList();
      }
    }
    function cancel() {
      if (done) return;
      done = true;
      renderChatList();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { cancel(); }
    });
    input.addEventListener("blur", commit);
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

  // ── Sending (Groq only — the L1 orchestrator) ───────────────────────────

  function sendMessage() {
    if (S.busy) return;
    var text = el.input.value.trim();
    if (!text) return;

    if (!S.activeId || !St.getChat(S.activeId)) {
      newChat();
    }
    var chat = activeChat();

    var p = Pr.PROVIDERS[CHAT_PROVIDER];
    var apiKey = St.loadByok()[p.keyName];

    if (!apiKey) {
      openSettings();
      flashStatus("Add your " + p.keyName + " in Settings to chat.");
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
      S.controller = null;
      if (el.input.value) autoResize();
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

  // ── Settings (BYOK + setup gate) ─────────────────────────────────────────

  function openSettings() {
    S.setupMode = !requiredReady();
    renderModalControls();
    try {
      renderKeysForm();
    } catch (err) {
      el.keysForm.innerHTML = "<p style=\"color:var(--danger)\">Could not load providers: " +
        Md.escapeHtml(String(err && err.message || err)) + "</p>";
    }
    el.modal.hidden = false;
  }

  function closeSettings() {
    if (S.setupMode && !requiredReady()) {
      flashStatus("Add and validate every required key (Layers 1–4) to continue.");
      return;
    }
    el.modal.hidden = true;
    el.settingsStatus.textContent = "";
  }

  function renderModalControls() {
    el.modalClose.hidden = S.setupMode;
    el.modalDone.disabled = S.setupMode;
    el.modalDone.textContent = S.setupMode
      ? "Continue — add required keys"
      : "Done";
  }

  function renderKeysForm() {
    var html = Object.keys(Pr.PROVIDERS).map(function (key) {
      var p = Pr.PROVIDERS[key];
      var cfg = Pr.isConfigured(key);
      var v = validationFor(key);
      var stateCls = "key-state";
      var stateTxt;
      if (!cfg) { stateTxt = "○ not set"; }
      else if (v === "ok") { stateCls += " on"; stateTxt = "● valid"; }
      else if (v === "fail") { stateCls += " bad"; stateTxt = "✗ invalid"; }
      else { stateCls += " on"; stateTxt = "● saved — save again to validate"; }

      var req = p.required
        ? "<span class=\"badge-required\">Required</span>"
        : "<span class=\"badge-opt\">Optional</span>";

      var inputs = "<input class=\"key\" type=\"password\" placeholder=\"" +
        (cfg ? "••••••••  (saved — type to replace)" : "Paste your " + p.keyName) +
        "\" autocomplete=\"off\">";
      if (p.accountName) {
        var hasAccount = St.hasByokKey(p.accountName);
        inputs += "<input class=\"account\" type=\"text\" placeholder=\"" +
          (hasAccount ? "••••••••  (saved — type to replace)" : "Paste your " + p.accountName) +
          "\" autocomplete=\"off\">";
      }

      return "<div class=\"key-row\" data-key=\"" + key + "\">" +
        "<div class=\"key-head\">" +
          "<span class=\"key-name\">" + p.keyName + "</span>" +
          "<span class=\"" + stateCls + "\">" + stateTxt + "</span>" +
        "</div>" +
        "<div class=\"layer-line\">" + p.layer + " · " + p.model + " " + req + "</div>" +
        inputs +
        "<div class=\"key-actions\">" +
          "<button class=\"mini-btn save\">Save &amp; validate</button>" +
          (cfg ? "<button class=\"mini-btn danger remove\">Remove</button>" : "") +
        "</div>" +
      "</div>";
    }).join("");
    el.keysForm.innerHTML = html;
  }

  function saveAndValidate(p, val, accountVal) {
    St.saveByokKey(p.keyName, val);
    if (p.accountName && accountVal) St.saveByokKey(p.accountName, accountVal);
    St.setValidation(p.key, "");

    if (!p.required) {
      St.setValidation(p.key, "ok");
      renderKeysForm();
      renderLayerStatus();
      renderModalControls();
      flashStatus(p.label + " key saved ✓");
      return;
    }

    var st = document.querySelector('#keys-form .key-row[data-key="' + p.key + '"] .key-state');
    if (st) { st.textContent = "↻ validating…"; st.className = "key-state busy"; }

    Pr.validate(p, val, accountVal).then(function (r) {
      St.setValidation(p.key, r.ok ? "ok" : "fail");
      renderKeysForm();
      renderLayerStatus();
      renderModalControls();
      flashStatus(r.msg);
      if (r.ok && requiredReady()) {
        S.setupMode = false;
        renderModalControls();
        setTimeout(function () { closeSettings(); }, 1200);
      }
    });
  }

  function flashStatus(msg) {
    el.settingsStatus.textContent = msg;
    setTimeout(function () { el.settingsStatus.textContent = ""; }, 6000);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function bindEvents() {
    el.newChat.addEventListener("click", newChat);

    el.chatList.addEventListener("click", function (e) {
      var del = e.target.closest("[data-del]");
      if (del) { deleteChat(del.getAttribute("data-del")); return; }
      var rn = e.target.closest("[data-rename]");
      if (rn) { startRename(rn.getAttribute("data-rename")); return; }
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

      if (e.target.closest(".save")) {
        var input = row.querySelector("input.key");
        var val = input ? input.value.trim() : "";
        if (!val) { flashStatus("Paste a " + p.keyName + " first."); return; }
        var accountInput = row.querySelector("input.account");
        var accountVal = accountInput ? accountInput.value.trim() : "";
        if (p.accountName && !accountVal) {
          flashStatus("Paste your " + p.accountName + " too.");
          return;
        }
        saveAndValidate(p, val, accountVal);
      } else if (e.target.closest(".remove")) {
        St.removeByokKey(p.keyName);
        if (p.accountName) St.removeByokKey(p.accountName);
        St.setValidation(key, "");
        S.setupMode = !requiredReady();
        renderKeysForm();
        renderLayerStatus();
        renderModalControls();
        if (S.activeId) renderMessages();
        else renderWelcome();
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
