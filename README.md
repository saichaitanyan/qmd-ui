# QMD UI — A Local Knowledge Base with a Human Interface

> A desktop UI wrapper for [qmd](https://github.com/tobi/qmd) — 
> search your notes, meetings, architecture docs, and finance 
> research with semantic AI, all local, all private.

![demo gif here]

## Why I Built This
QMD is powerful but CLI-only. I wanted to search my personal 
knowledge base from a clean UI — and from my phone on the same 
Wi-Fi — without typing paths every time.

## Features
- 🔍 Fast keyword search + deep semantic AI search
- 📁 Visual collection manager (no CLI path memorization)
- 📄 Supports `.md`, `.txt`, `.docx` — auto-converts on add
- 📱 HTTP API layer for mobile access on local network
- 🔒 Fully local — zero cloud, zero telemetry
- 🛡️ Hardened input sanitization (no shell injection)

## Stack
- **Backend**: Bun + QMD CLI
- **Frontend**: Plain HTML + Bootstrap 5 (no React, no build step)
- **Desktop**: Tauri 2.0
- **Search Engine**: [qmd](https://github.com/tobi/qmd) by @tobi

