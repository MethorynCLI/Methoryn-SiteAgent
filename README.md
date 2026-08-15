# Methoryn SiteAgent

A browser-based AI chat agent for the Methoryn site. It is the web sibling of
the [Methoryn CLI](https://github.com/MethorynCLI/Methoryn-Core) — same dark
terminal look, same multi-provider spirit — but it runs entirely in the browser,
so there are **no command scripts, no PowerShell, no server** to run anything.
Your keys never touch a server; they stay in your own browser.

**Live:** https://Methoryncli.github.io/Methoryn-SiteAgent/

## Features

- **BYOK (Bring Your Own Key)** — add your own API keys in Settings. They are
  stored only in your browser's `localStorage` and sent directly from your
  browser to the provider you pick. Nothing is ever uploaded to us.
- **Multi-provider chat** — the same agent layers as the CLI:
  - `L1 Groq` (Llama 3.3 70B) — conversation & orchestration (required)
  - `L3 Gemini` (Gemini 3.6 Flash) — multimodal & research
  - `L4 Mistral` (Mistral Medium 3.5) — coding
  - `L5 NVIDIA` (GLM-5.2) — quality control
- **Chat history** — every chat keeps its own history and sends it to Groq (or
  whichever provider you select), so the model remembers the conversation —
  exactly like the CLI.
- **Selectable chats** — sidebar chat list: create, switch, and delete chats.
- **Streaming replies** — responses stream in token by token.
- **Markdown rendering** — code blocks, headings, lists, links, and more.

## Run it locally

It is a static site. Any of these work:

```bash
# Serve the folder (no build step)
python -m http.server 8000 --directory MethorynSiteAgent
# then open http://localhost:8000

# Or just open index.html directly in a browser
```

## Getting an API key

1. Open Settings (gear icon, bottom left).
2. Add a **Groq** key (free at https://console.groq.com) — this powers chat.
3. Optionally add Gemini / Mistral / NVIDIA keys for the other layers.
4. Pick a provider in the top bar and start chatting.

## Project structure

```
MethorynSiteAgent/
├── index.html      — chat app shell
├── style.css       — CLI-inspired dark theme
├── js/
│   ├── storage.js  — BYOK keys + chats (localStorage)
│   ├── providers.js— Groq / Gemini / Mistral / NVIDIA browser clients
│   ├── markdown.js — safe markdown → HTML renderer
│   └── app.js      — chat UI, streaming, settings
├── LICENSE         — MIT
└── README.md
```

## Security notes

- API keys are stored in `localStorage` on **your** machine and sent only to the
  provider you choose. Clearing your browser data removes them.
- The SiteAgent cannot run shell commands, PowerShell, or any server-side code.
- It is released through the Methoryn `release.py` script — the version badge in
  `index.html` is updated automatically on each release.

## License

MIT — see [LICENSE](LICENSE).
