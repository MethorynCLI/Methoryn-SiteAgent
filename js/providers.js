/**
 * providers.js — browser-side clients for the Methoryn agent layers.
 * Translates the CLI's Groq / Gemini / Mistral / NVIDIA agents into plain
 * fetch() calls. No server, no shell — the browser talks to each API directly.
 */
(function () {
  "use strict";

  // ── Shared SSE parser ────────────────────────────────────────────────────

  function parseSSE(res, onDelta, onDone, signal) {
    return new Promise(function (resolve, reject) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var buffer = "";
      var doneFlag = false;

      function pump() {
        reader.read().then(function (result) {
          if (doneFlag) return;
          if (result.done) {
            onDone && onDone();
            resolve();
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop(); // keep partial line
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.startsWith("data:")) {
              var payload = line.slice(5).trim();
              if (payload === "[DONE]") {
                doneFlag = true;
                onDone && onDone();
                resolve();
                return;
              }
              try {
                var json = JSON.parse(payload);
                var delta = extractDelta(json);
                if (delta) onDelta(delta);
                if (json.usageMetadata || json.usage) onDone && onDone();
              } catch (e) {
                // skip malformed chunks
              }
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

  // Each provider's chunk → text extractor
  function extractDelta(json) {
    if (json.choices && json.choices[0]) {
      var delta = json.choices[0].delta;
      if (delta && delta.content) return delta.content;
      if (json.choices[0].text) return json.choices[0].text;
    }
    if (json.candidates && json.candidates[0]) {
      var parts = json.candidates[0].content && json.candidates[0].content.parts;
      if (parts && parts[0] && parts[0].text) return parts[0].text;
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

  // ── Provider definitions ─────────────────────────────────────────────────
  // Mirrors the CLI agent layers in config.py.

  var PROVIDERS = {
    groq: {
      key: "groq",
      label: "Groq",
      keyName: "GROQ_API_KEY",
      layer: "L1 Conversation & Orchestration",
      model: "llama-3.3-70b-versatile",
      required: true,
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

    gemini: {
      key: "gemini",
      label: "Gemini",
      keyName: "GOOGLE_API_KEY",
      layer: "L3 Multimodal & Research",
      model: "gemini-3.6-flash",
      required: false,
      stream: function (o) {
        var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
          o.model + ":streamGenerateContent?alt=sse&key=" +
          encodeURIComponent(o.apiKey);
        var contents = [];
        o.messages.forEach(function (m) {
          if (m.role === "system") return;
          contents.push({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
          });
        });
        var systemPrompt = (o.messages[0] && o.messages[0].role === "system")
          ? o.messages[0].content : "";
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
            contents: contents,
            generationConfig: { temperature: 0.2 },
          }),
          signal: o.signal,
        }).then(function (res) {
          return checkResponse(res).then(function () { return res; });
        }).then(function (res) {
          return parseSSE(res, o.onDelta, o.onDone, o.signal);
        });
      },
    },

    mistral: {
      key: "mistral",
      label: "Mistral",
      keyName: "MISTRAL_API_KEY",
      layer: "L4 Coding Agent",
      model: "mistral-medium-3.5",
      required: false,
      stream: function (o) {
        return openaiCompatStream({
          url: "https://api.mistral.ai/v1/chat/completions",
          apiKey: o.apiKey,
          model: o.model,
          messages: o.messages,
          onDelta: o.onDelta,
          onDone: o.onDone,
          signal: o.signal,
        });
      },
    },

    nvidia: {
      key: "nvidia",
      label: "NVIDIA",
      keyName: "NVDA_API_KEY",
      layer: "L5 Quality Control",
      model: "zhipuai/glm-5-2:free",
      required: false,
      stream: function (o) {
        return openaiCompatStream({
          url: "https://integrate.api.nvidia.com/v1/chat/completions",
          apiKey: o.apiKey,
          model: o.model,
          messages: o.messages,
          onDelta: o.onDelta,
          onDone: o.onDone,
          signal: o.signal,
        });
      },
    },
  };

  // ── System prompt (web-adapted from the CLI) ─────────────────────────────
  var MAX_HISTORY = 20;

  function buildSystemPrompt() {
    return [
      "You are Methoryn — a browser-based multi-agent AI assistant.",
      "You are running in the user's web browser. You CANNOT run shell commands, PowerShell, or any code, and you cannot touch the user's computer. Keep everything to conversation, explanation, and generated content.",
      "Delegation (conceptual): gemini = research/multimodal · mistral = code · nvidia = review.",
      "STYLE: concise plain prose; match the user's language; use backtick paths or commands as text; never fabricate outputs; after answering, offer one short follow-up.",
    ].join("\n");
  }

  function buildMessages(history) {
    var trimmed = history.slice(-MAX_HISTORY);
    var messages = [{ role: "system", content: buildSystemPrompt() }];
    return messages.concat(trimmed);
  }

  function isConfigured(providerKey) {
    var p = PROVIDERS[providerKey];
    if (!p) return false;
    return Boolean(window.MethorynStorage && window.MethorynStorage.hasByokKey(p.keyName));
  }

  window.MethorynProviders = {
    PROVIDERS: PROVIDERS,
    parseSSE: parseSSE,
    buildMessages: buildMessages,
    isConfigured: isConfigured,
    getSystemPrompt: buildSystemPrompt,
  };
})();
