/**
 * providers.js — Methoryn agent layers, streaming, and live key validation.
 *
 * The SiteAgent chats with L1 Groq only (the orchestrator), exactly like the
 * CLI: you talk to one agent and the five-layer stack works behind it.
 * Layers 2–5 stay configured and validated in Settings.
 */
(function () {
  "use strict";

  // ── SSE parser for OpenAI-compatible streaming ─────────────────────────

  function parseSSE(res, onDelta, onDone) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    return new Promise(function (resolve, reject) {
      function pump() {
        reader.read().then(function (result) {
          if (result.done) { resolve(); return; }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.slice(0, 6) === "data: ") line = line.slice(6);
            else if (line === "data:") line = "";
            else if (line.indexOf("data:") !== 0) continue;
            if (line === "[DONE]") { onDone && onDone(); resolve(); return; }
            var payload = line.trim();
            if (!payload) continue;
            try {
              var json = JSON.parse(payload);
              var delta = extractDelta(json);
              if (delta) onDelta(delta);
              if (json.usage) onDone && onDone();
            } catch (e) {
              // skip malformed chunks
            }
          }
          pump();
        }).catch(function (err) {
          if (err.name !== "AbortError") reject(err);
          else reject(new Error("aborted"));
        });
      }
      pump();
    });
  }

  // Chunk → text extractor for OpenAI-compatible streams
  function extractDelta(json) {
    if (json.choices && json.choices[0]) {
      var delta = json.choices[0].delta;
      if (delta && delta.content) return delta.content;
      if (json.choices[0].text) return json.choices[0].text;
    }
    return "";
  }

  function checkResponse(res) {
    if (res.ok) return Promise.resolve();
    return res.text().then(function (text) {
      var msg = "HTTP " + res.status;
      try {
        var j = JSON.parse(text);
        msg = j.error && (j.error.message || j.error.code) || msg;
      } catch (e) { /* keep default */ }
      throw new Error(msg);
    });
  }

  function openaiCompatStream(opts) {
    var url = opts.url, apiKey = opts.apiKey, model = opts.model;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: opts.messages,
        stream: true,
        temperature: 0.2,
      }),
      signal: opts.signal,
    }).then(function (res) {
      return checkResponse(res).then(function () { return res; });
    }).then(function (res) {
      return parseSSE(res, opts.onDelta, opts.onDone, opts.signal);
    });
  }

  // ── Provider definitions (mirrors CLI config.py + setup_screen.py) ──────

  var PROVIDERS = {
    groq: {
      key: "groq",
      label: "Groq",
      keyName: "GROQ_API_KEY",
      layer: "L1 Conversation & Orchestration",
      model: "llama-3.3-70b-versatile",
      required: true,
      chat: true,
      stream: function (o) {
        return openaiCompatStream({
          url: "https://api.groq.com/openai/v1/chat/completions",
          apiKey: o.apiKey,
          model: o.model,
          messages: o.messages,
          onDelta: o.onDelta,
          onDone: o.onDone,
          signal: o.signal,
        });
      },
    },

    cloudflare: {
      key: "cloudflare",
      label: "Cloudflare",
      keyName: "CLOUDFLARE_API_KEY",
      accountName: "CLOUDFLARE_ACCOUNT_ID",
      layer: "L2 Library & Task-Planner",
      model: "GLM-4.7 Flash · Workers AI",
      required: true,
      chat: false,
    },

    gemini: {
      key: "gemini",
      label: "Gemini",
      keyName: "GOOGLE_API_KEY",
      layer: "L3 Multimodal & Research",
      model: "gemini-3.6-flash",
      required: true,
      chat: false,
    },

    mistral: {
      key: "mistral",
      label: "Mistral",
      keyName: "MISTRAL_API_KEY",
      layer: "L4 Coding Agent",
      model: "mistral-medium-3.5",
      required: true,
      chat: false,
    },

    nvidia: {
      key: "nvidia",
      label: "NVIDIA",
      keyName: "NVDA_API_KEY",
      layer: "L5 Quality Control",
      model: "zhipuai/glm-5-2:free",
      required: false,
      chat: false,
    },
  };

  // ── System prompt (you talk to L1 Groq, the orchestrator) ───────────────

  var MAX_HISTORY = 20;

  function buildSystemPrompt() {
    return [
      "You are Methoryn — a multi-agent AI assistant running in the user's web browser.",
      "You are Layer 1 (Groq), the conversation & orchestration agent. Behind you sits a five-layer stack: L2 Cloudflare (library & task-planner), L3 Gemini (research & multimodal), L4 Mistral (coding agent), L5 NVIDIA (quality control).",
      "In the browser you CANNOT run shell commands, PowerShell, or code, and you cannot touch the user's computer. Keep everything to conversation, explanation, and generated content.",
      "STYLE: concise plain prose; match the user's language; use backtick paths or commands as text; never fabricate outputs; after answering, offer one short follow-up.",
    ].join("\n");
  }

  function buildMessages(history) {
    var trimmed = history.slice(-MAX_HISTORY);
    var sanitized = trimmed.map(function (m) {
      return { role: m.role, content: String(m.content || "") };
    });
    var messages = [{ role: "system", content: buildSystemPrompt() }];
    return messages.concat(sanitized);
  }

  // ── Live key validation (mirrors CLI setup_screen.py) ───────────────────

  function validate(p, value, accountValue) {
    // Cloudflare's API does not send CORS headers, so the browser cannot
    // probe it live.  Presence + format is the closest we can get — the key
    // is not used for chat anyway (L2 runs inside the CLI).
    if (p.key === "cloudflare") {
      if (!value || !accountValue) {
        return Promise.resolve({
          ok: false,
          msg: "Paste both the Cloudflare API token and Account ID.",
        });
      }
      return Promise.resolve({
        ok: true,
        msg: "Cloudflare keys saved — format OK (live probe is CLI-only: Cloudflare's API has no CORS).",
      });
    }

    var url, headers = {};
    if (p.key === "groq") {
      url = "https://api.groq.com/openai/v1/models";
      headers = { "Authorization": "Bearer " + value };
    } else if (p.key === "gemini") {
      url = "https://generativelanguage.googleapis.com/v1beta/models?key=" +
        encodeURIComponent(value);
    } else if (p.key === "mistral") {
      url = "https://api.mistral.ai/v1/models";
      headers = { "Authorization": "Bearer " + value };
    } else {
      return Promise.resolve({ ok: true, msg: p.label + " key saved ✓" });
    }

    return fetch(url, { headers: headers })
      .then(function (res) {
        if (res.status === 200) return { ok: true, msg: p.label + " key valid ✓" };
        if (res.status === 401) return { ok: false, msg: p.label + " key invalid (401 unauthorized)" };
        if (res.status === 403) return { ok: false, msg: p.label + " key invalid (403 forbidden)" };
        if (res.status === 400) return { ok: false, msg: p.label + " key invalid (400 bad request)" };
        return { ok: false, msg: p.label + " returned HTTP " + res.status };
      })
      .catch(function (err) {
        return { ok: false, msg: p.label + " check failed: " + (err && err.message || err) };
      });
  }

  function isConfigured(providerKey) {
    var p = PROVIDERS[providerKey];
    if (!p) return false;
    var St = window.MethorynStorage;
    if (!St || !St.hasByokKey(p.keyName)) return false;
    if (p.accountName && !St.hasByokKey(p.accountName)) return false;
    return true;
  }

  window.MethorynProviders = {
    PROVIDERS: PROVIDERS,
    parseSSE: parseSSE,
    buildMessages: buildMessages,
    isConfigured: isConfigured,
    validate: validate,
    getSystemPrompt: buildSystemPrompt,
  };
})();
