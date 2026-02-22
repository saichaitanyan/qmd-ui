# QMD UI

**A premium desktop UI for [qmd](https://github.com/tobi/qmd) — search your local documents with AI, fully private.**

> Fast keyword search or deep semantic AI search across your notes, meetings, and research — nothing leaves your machine.

---

## ✨ Features

| Feature | Description |
|---|---|
| ⚡ **Fast Search** | BM25 keyword matching — instant results |
| 🧠 **Deep Search** | AI semantic search with query expansion & reranking |
| 📁 **Collection Manager** | Add, remove, and filter document collections from the UI |
| 📄 **File Converter** | Auto-converts `.docx` and `.txt` to `.md` via file watcher |
| 🌓 **Dark / Light Theme** | Toggle with one click, persisted across sessions |
| ⛔ **Cancel Search** | Abort in-progress searches with `Esc` or the Cancel button |
| 🔒 **Fully Local** | Zero cloud, zero telemetry — everything on your machine |
| 🛡️ **Input Sanitization** | Shell injection and path traversal protection on all inputs |

---

## 📦 Prerequisites

| Requirement | Version | Check |
|---|---|---|
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **qmd CLI** | 1.0+ | `qmd --version` |

### Install qmd

If you don't have `qmd` installed, follow the instructions at [github.com/tobi/qmd](https://github.com/tobi/qmd).

On macOS with Homebrew:
```bash
brew install tobi/tap/qmd
```

---

## 🚀 Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/saichaitanyan/qmd-ui.git
cd qmd-ui

# 2. Install dependencies
npm install

# 3. Start the server
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 📁 Setting Up Collections

Before you can search, you need to add at least one document collection.

### Option A: Via the UI
1. Click **Collections** in the top-right navbar
2. Enter a name, file pattern (e.g. `**/*.md`), and the folder path
3. Click **Add Collection**
4. Click **Re-embed All** to generate vector embeddings for deep search

### Option B: Via the qmd CLI
```bash
# Add a collection
qmd collection add /path/to/your/docs --name "my-notes" --mask "**/*.md"

# Build the index
qmd update

# Generate embeddings (required for Deep search)
qmd embed
```

---

## 🔍 How to Search

| Action | How |
|---|---|
| **Fast search** | Type your query → press `Enter` or click ⚡ Fast |
| **Deep search** | Type your query → press `Shift+Enter` or click ✨ Deep |
| **Focus search bar** | Press `/` from anywhere |
| **Cancel search** | Press `Esc` or click the Cancel button |
| **Filter by collection** | Click a collection pill below the search bar |
| **Open a result** | Click any result card to open it in your default editor |

---

## For Developers

QMD UI exposes a REST API at `http://localhost:3000/api` for all operations (search, collections, converter, file open). See [`server.js`](server.js) for the full endpoint list.

---

## 🗂 Project Structure

```
qmd-ui/
├── server.js          ← Express API server (wraps qmd CLI)
├── converter.js       ← .docx/.txt → .md file watcher
├── public/
│   ├── index.html     ← Main UI (Bootstrap 5)
│   ├── style.css      ← Design system (dark/light themes)
│   ├── app.js         ← Frontend logic
│   └── favicon.svg    ← Brand favicon
├── package.json
├── LICENSE            ← MIT (QMD UI)
├── NOTICE             ← Upstream qmd attribution
└── README.md
```

---

## 🏗 Tech Stack

| Layer | Technology |
|---|---|
| **Server** | Node.js + Express |
| **Frontend** | HTML + Bootstrap 5 + Vanilla JS |
| **Search** | [qmd](https://github.com/tobi/qmd) CLI (external) |
| **Converter** | mammoth.js + chokidar |
| **Fonts** | Inter + JetBrains Mono (Google Fonts) |

---

## ⚠️ Troubleshooting

### "qmd: command not found"
Make sure `qmd` is installed and in your PATH. Run `qmd --version` to verify.

### "EADDRINUSE: port 3000 already in use"
Another process is using port 3000. Kill it or change the port:
```bash
PORT=3001 node server.js
```

### Deep search returns no results
You need to generate embeddings first:
```bash
qmd embed
```
This runs local AI models to create vector embeddings. It may take a few minutes on first run.

### File open fails with "does not exist"
The qmd index may be stale. Re-index your collections:
```bash
qmd update
```

---

## 📜 Attribution

This project is an **independent, unofficial** UI wrapper for the
[qmd](https://github.com/tobi/qmd) CLI tool by Tobi Lutke. It is
**not affiliated with, endorsed by, or connected to** the qmd project
or its authors.

QMD UI calls the `qmd` binary as an external process — it does not
bundle, modify, or redistribute any qmd source code.

## 📄 License

- **QMD UI**: MIT License © 2026 Nare Sai Chaitanya — see [LICENSE](LICENSE)
- **qmd (upstream)**: MIT License © 2024–2026 Tobi Lutke — see [NOTICE](NOTICE)
