/**
 * storage.js — BYOK keys and chat persistence (browser localStorage).
 * Nothing here ever leaves the browser; keys are only read by providers.js
 * and sent straight to the provider the user selects.
 */
(function () {
  "use strict";

  var KEYS_DB = "methoryn_siteagent_byok";
  var CHATS_DB = "methoryn_siteagent_chats";
  var VALIDATION_DB = "methoryn_siteagent_validation";

  // ── BYOK keys ────────────────────────────────────────────────────────────

  function loadByok() {
    try {
      return JSON.parse(localStorage.getItem(KEYS_DB)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveByokKey(name, value) {
    var data = loadByok();
    if (value) data[name] = value;
    else delete data[name];
    localStorage.setItem(KEYS_DB, JSON.stringify(data));
  }

  function removeByokKey(name) {
    var data = loadByok();
    if (name in data) {
      delete data[name];
      localStorage.setItem(KEYS_DB, JSON.stringify(data));
      return true;
    }
    return false;
  }

  function listByokKeys() {
    return Object.keys(loadByok()).sort();
  }

  function hasByokKey(name) {
    return Boolean((loadByok())[name]);
  }

  // ── Key validation status (mirrors the CLI's live setup checks) ─────────

  function loadValidation() {
    try {
      return JSON.parse(localStorage.getItem(VALIDATION_DB)) || {};
    } catch (e) {
      return {};
    }
  }

  function setValidation(providerKey, status) {
    var v = loadValidation();
    if (status) v[providerKey] = status;
    else delete v[providerKey];
    localStorage.setItem(VALIDATION_DB, JSON.stringify(v));
  }

  function isSetupComplete() {
    var v = loadValidation();
    return Object.keys(v).length > 0;
  }

  // ── Chats ────────────────────────────────────────────────────────────────

  function loadChats() {
    try {
      return JSON.parse(localStorage.getItem(CHATS_DB)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveChats(chats) {
    localStorage.setItem(CHATS_DB, JSON.stringify(chats));
  }

  function createChat() {
    var chats = loadChats();
    var chat = {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: "New chat",
      createdAt: Date.now(),
      messages: [],
      provider: null,      // provider used for the last reply
      model: null,         // model used for the last reply
    };
    chats.unshift(chat);
    saveChats(chats);
    return chat;
  }

  function deleteChat(id) {
    var chats = loadChats().filter(function (c) { return c.id !== id; });
    saveChats(chats);
    return chats;
  }

  function getChat(id) {
    return loadChats().find(function (c) { return c.id === id; }) || null;
  }

  function updateChat(chat) {
    var chats = loadChats();
    var idx = chats.findIndex(function (c) { return c.id === chat.id; });
    if (idx === -1) return;
    chats[idx] = chat;
    saveChats(chats);
  }

  window.MethorynStorage = {
    loadByok: loadByok,
    saveByokKey: saveByokKey,
    removeByokKey: removeByokKey,
    listByokKeys: listByokKeys,
    hasByokKey: hasByokKey,
    loadValidation: loadValidation,
    setValidation: setValidation,
    isSetupComplete: isSetupComplete,
    loadChats: loadChats,
    saveChats: saveChats,
    createChat: createChat,
    deleteChat: deleteChat,
    getChat: getChat,
    updateChat: updateChat,
  };
})();
