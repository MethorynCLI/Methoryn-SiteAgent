/**
 * google.js — client-side Google sign-in (Google Identity Services) and
 * Google Docs tool execution.  Tokens live only in localStorage; nothing
 * is proxied through a server.
 *
 * Chat flow: Groq emits one-line `GOOGLE_TOOL: {…}` protocol commands
 * (see providers.js system prompt) and app.js hands them to executeLines().
 */
(function () {
  "use strict";

  var St = window.MethorynStorage;

  var SCOPE = "https://www.googleapis.com/auth/documents";
  var DEFAULT_CLIENT_ID = "91203123933-84k159ldkciga6nlbo5ib7bcd13uunrd.apps.googleusercontent.com";

  var lastDocId = null;

  function getConnection() {
    return St.loadGoogleConnection();
  }

  function isConnected() {
    var c = getConnection();
    return Boolean(c && c.access_token && c.expires_at && c.expires_at > Date.now());
  }

  function getConnectedEmail() {
    var c = getConnection();
    return c && c.email ? c.email : "";
  }

  function getAccessToken() {
    var c = getConnection();
    if (!c || !c.access_token) return null;
    if (c.expires_at && c.expires_at <= Date.now()) return null;
    return c.access_token;
  }

  function gisReady() {
    return Boolean(window.google && window.google.accounts && window.google.accounts.oauth2);
  }

  /**
   * Run the Google sign-in popup.  Resolves with the connected email.
   * Rejects with a readable message on failure or if the library is missing.
   */
  function connect(clientId) {
    clientId = clientId || DEFAULT_CLIENT_ID;
    return new Promise(function (resolve, reject) {
      if (!gisReady()) {
        reject(new Error(
          "Google sign-in library not loaded (blocked? offline?). Try again, or use the CLI's /account."
        ));
        return;
      }
      var tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: function (resp) {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: "Bearer " + resp.access_token },
          }).then(function (r) {
            if (!r.ok) return { email: "" };
            return r.json().catch(function () { return { email: "" }; });
          }).then(function (info) {
            St.saveGoogleConnection({
              email: info.email || "",
              access_token: resp.access_token,
              expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
            });
            resolve(getConnectedEmail());
          });
        },
      });
      tokenClient.requestAccessToken();
    });
  }

  function disconnect() {
    lastDocId = null;
    St.clearGoogleConnection();
  }

  // ── Docs API ─────────────────────────────────────────────────────────────

  function api(path, token, method, body) {
    return fetch("https://docs.googleapis.com/v1" + path, {
      method: method || "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function createDocument(token, title) {
    return api("/documents", token, "POST", { title: title }).then(function (doc) {
      lastDocId = doc.documentId;
      return doc;
    });
  }

  function insertText(token, documentId, text) {
    return api("/documents/" + encodeURIComponent(documentId) + ":batchUpdate", token, "POST", {
      requests: [{ insertText: { location: { index: 1 }, text: text } }],
    }).then(function () {
      return { documentId: documentId };
    });
  }

  function resolveDocId(ref) {
    if (!ref) return null;
    if (ref === "$doc") return lastDocId;
    if (ref && typeof ref === "object" && ref.created_doc) return lastDocId;
    return String(ref);
  }

  // ── Tool protocol execution ───────────────────────────────────────────────

  function executeTool(payload) {
    var token = getAccessToken();
    if (!token) {
      return Promise.reject(new Error(
        "Google account not connected or session expired — reconnect in Settings."
      ));
    }
    var action = payload && payload.action;
    if (action === "create_doc") {
      return createDocument(token, String(payload.title || "Untitled")).then(function (doc) {
        return "Created Google Doc \u201c" + (doc.title || payload.title) + "\u201d: " + doc.url;
      });
    }
    if (action === "insert_text") {
      var id = resolveDocId(payload.document_id);
      if (!id) {
        return Promise.reject(new Error("No document to insert into (missing $doc)."));
      }
      return insertText(token, id, String(payload.text || "")).then(function () {
        return "Inserted text into doc " + id;
      });
    }
    return Promise.reject(new Error("Unknown Google tool action: " + action));
  }

  /**
   * Execute an array of GOOGLE_TOOL payload strings (JSON) sequentially.
   * Resolves with [{ ok, msg }] — one entry per line, never rejects.
   */
  function executeLines(lines) {
    var results = [];
    function step(i) {
      if (i >= lines.length) return Promise.resolve(results);
      var payload;
      try {
        payload = JSON.parse(lines[i]);
      } catch (e) {
        results.push({ ok: false, msg: "Bad GOOGLE_TOOL JSON: " + e.message });
        return step(i + 1);
      }
      return executeTool(payload).then(function (msg) {
        results.push({ ok: true, msg: msg });
        return step(i + 1);
      }).catch(function (err) {
        results.push({ ok: false, msg: String(err && err.message || err) });
        return step(i + 1);
      });
    }
    return step(0);
  }

  window.MethorynGoogle = {
    getConnection: getConnection,
    isConnected: isConnected,
    getConnectedEmail: getConnectedEmail,
    getAccessToken: getAccessToken,
    connect: connect,
    disconnect: disconnect,
    executeLines: executeLines,
  };
})();
