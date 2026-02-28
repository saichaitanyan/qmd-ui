import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { watchDir, unwatchDir, getWatchedDirs, convertFile } from "./converter.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Sanitization helpers ─────────────────────────────────────────────

/** Allow only safe characters for search queries */
function sanitizeQuery(q) {
    if (typeof q !== "string" || q.length === 0 || q.length > 500) return null;
    // Strip anything that could be a shell metacharacter
    // Allow: letters, digits, spaces, common punctuation for natural language
    if (/[;&|`$(){}[\]<>!\\]/.test(q)) return null;
    return q.trim();
}

/** Allow only safe collection names */
function sanitizeName(name) {
    if (typeof name !== "string" || name.length === 0 || name.length > 100) return null;
    if (/[;&|`$(){}[\]<>!\\\/]/.test(name)) return null;
    return name.trim();
}

/** Allow only safe filesystem paths — block traversal */
function sanitizePath(p) {
    if (typeof p !== "string" || p.length === 0 || p.length > 500) return null;
    if (/[;&|`$(){}[\]<>!\\]/.test(p)) return null;
    // Block path traversal
    if (p.includes("..")) return null;
    return p.trim();
}

/** Allow only safe glob masks */
function sanitizeMask(mask) {
    if (typeof mask !== "string" || mask.length === 0 || mask.length > 100) return null;
    // Allow: letters, digits, *, ?, /, ., -
    if (!/^[a-zA-Z0-9\*\?\/\.\-\_]+$/.test(mask)) return null;
    return mask.trim();
}

// ─── Helper to run qmd commands ───────────────────────────────────────

async function runQmd(args, timeoutMs = 60_000) {
    try {
        const { stdout, stderr } = await execFileAsync("qmd", args, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
        return {
            ok: false,
            stdout: err.stdout?.trim() || "",
            stderr: err.stderr?.trim() || err.message,
        };
    }
}

// ─── Resolve qmd:// URIs to filesystem paths ─────────────────────────

/**
 * Reads ~/.config/qmd/index.yml to find collection source paths,
 * then maps a qmd://collection/file URI to the actual filesystem path.
 */
function resolveQmdUri(uri) {
    if (!uri || !uri.startsWith("qmd://")) return uri;

    const inner = uri.slice("qmd://".length); // "knowledge base/qmd-ui-notes.txt"
    const slashIdx = inner.indexOf("/");
    if (slashIdx < 0) return null;

    const collectionName = inner.substring(0, slashIdx);
    const relativePath = inner.substring(slashIdx + 1);

    // Read the qmd config to find the collection's source directory
    const configPath = path.join(os.homedir(), ".config", "qmd", "index.yml");
    try {
        const yml = fs.readFileSync(configPath, "utf-8");
        // Simple YAML parsing — find "  collectionName:\n    path: /some/dir"
        // We look for the collection block and extract the path value
        const lines = yml.split("\n");
        let inCollection = false;
        for (const line of lines) {
            // Match collection header like '  knowledge base:' or '  my-docs:'
            const headerMatch = line.match(/^  (.+?):\s*$/);
            if (headerMatch) {
                inCollection = headerMatch[1] === collectionName;
                continue;
            }
            if (inCollection) {
                const pathMatch = line.match(/^    path:\s*(.+)$/);
                if (pathMatch) {
                    const basePath = pathMatch[1].trim();
                    return path.join(basePath, relativePath);
                }
            }
        }
    } catch {
        // config not found or unreadable
    }
    return null;
}

// ─── API Routes ───────────────────────────────────────────────────────

/**
 * GET /api/collections
 * Returns list of collections with name, pattern, file count
 */
app.get("/api/collections", async (_req, res) => {
    const result = await runQmd(["collection", "list"]);
    if (!result.ok) {
        return res.status(500).json({ error: "Failed to list collections", detail: result.stderr });
    }

    // Parse the text output into structured data
    const collections = [];
    const blocks = result.stdout.split("\n\n").filter(Boolean);
    for (const block of blocks) {
        const lines = block.split("\n").map((l) => l.trim());
        // First line is "name (qmd://name/)"
        const nameMatch = lines[0]?.match(/^(.+?)\s+\(qmd:\/\//);
        if (!nameMatch) continue;
        const name = nameMatch[1];
        const pattern = lines.find((l) => l.startsWith("Pattern:"))?.replace("Pattern:", "").trim() || "";
        const filesStr = lines.find((l) => l.startsWith("Files:"))?.replace("Files:", "").trim() || "0";
        const files = parseInt(filesStr, 10) || 0;
        collections.push({ name, pattern, files });
    }

    res.json({ collections });
});

/**
 * POST /api/search
 * Body: { q: string, collection?: string, n?: number }
 * Fast BM25 keyword search
 */
app.post("/api/search", async (req, res) => {
    const q = sanitizeQuery(req.body.q);
    if (!q) return res.status(400).json({ error: "Invalid or missing query" });

    const n = Math.min(Math.max(parseInt(req.body.n) || 10, 1), 50);
    const args = ["search", q, "--json", "-n", String(n)];

    if (req.body.collection) {
        const col = sanitizeName(req.body.collection);
        if (!col) return res.status(400).json({ error: "Invalid collection name" });
        args.push("-c", col);
    }

    const result = await runQmd(args);
    if (!result.ok) {
        return res.status(500).json({ error: "Search failed", detail: result.stderr });
    }

    try {
        const results = JSON.parse(result.stdout);
        res.json({ results, mode: "fast" });
    } catch {
        res.json({ results: [], mode: "fast", raw: result.stdout });
    }
});

/**
 * POST /api/query
 * Body: { q: string, collection?: string, n?: number }
 * Deep semantic search with query expansion + reranking
 */
app.post("/api/query", async (req, res) => {
    const q = sanitizeQuery(req.body.q);
    if (!q) return res.status(400).json({ error: "Invalid or missing query" });

    const n = Math.min(Math.max(parseInt(req.body.n) || 5, 1), 20);
    const args = ["query", q, "--json", "-n", String(n)];

    if (req.body.collection) {
        const col = sanitizeName(req.body.collection);
        if (!col) return res.status(400).json({ error: "Invalid collection name" });
        args.push("-c", col);
    }

    // query uses LLM — give it more time
    const result = await runQmd(args, 120_000);
    if (!result.ok) {
        return res.status(500).json({ error: "Query failed", detail: result.stderr });
    }

    try {
        const results = JSON.parse(result.stdout);
        res.json({ results, mode: "deep" });
    } catch {
        res.json({ results: [], mode: "deep", raw: result.stdout });
    }
});

/**
 * POST /api/collection/add
 * Body: { name: string, path: string, mask?: string }
 */
app.post("/api/collection/add", async (req, res) => {
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: "Invalid collection name" });

    const dirPath = sanitizePath(req.body.path);
    if (!dirPath) return res.status(400).json({ error: "Invalid path" });

    const mask = req.body.mask ? sanitizeMask(req.body.mask) : "**/*.md";
    if (!mask) return res.status(400).json({ error: "Invalid mask pattern" });

    const args = ["collection", "add", dirPath, "--name", name, "--mask", mask];
    const result = await runQmd(args, 30_000);

    if (!result.ok) {
        return res.status(500).json({ error: "Failed to add collection", detail: result.stderr });
    }

    res.json({ success: true, message: result.stdout || "Collection added" });
});

/**
 * POST /api/embed
 * Triggers vector embedding for all collections
 */
app.post("/api/embed", async (_req, res) => {
    const result = await runQmd(["embed"], 300_000); // can take a while
    if (!result.ok) {
        return res.status(500).json({ error: "Embedding failed", detail: result.stderr });
    }
    res.json({ success: true, message: result.stdout || "Embedding complete" });
});

/**
 * POST /api/open
 * Body: { file: string }
 * Opens a file using the system default app (macOS: open).
 * Handles qmd:// URIs by resolving them to filesystem paths first.
 */
app.post("/api/open", async (req, res) => {
    let file = req.body.file;
    if (typeof file !== "string" || !file) {
        return res.status(400).json({ error: "Invalid file path" });
    }

    // Resolve qmd:// URIs to actual filesystem paths
    if (file.startsWith("qmd://")) {
        const resolved = resolveQmdUri(file);
        console.log(`  📂 Resolving: ${file} → ${resolved}`);
        if (!resolved) {
            return res.status(400).json({ error: "Could not resolve qmd:// URI to a filesystem path" });
        }
        file = resolved;
    }

    // Sanitize the resolved path
    const safePath = sanitizePath(file);
    if (!safePath) return res.status(400).json({ error: "Invalid file path" });

    try {
        await execFileAsync("open", [safePath], { timeout: 5000 });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to open file", detail: err.message });
    }
});

/**
 * POST /api/collection/remove
 * Body: { name: string }
 */
app.post("/api/collection/remove", async (req, res) => {
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: "Invalid collection name" });

    const result = await runQmd(["collection", "remove", name], 10_000);
    if (!result.ok) {
        return res.status(500).json({ error: "Failed to remove collection", detail: result.stderr });
    }
    res.json({ success: true, message: result.stdout || "Collection removed" });
});

/**
 * GET /api/status
 * Returns qmd index status
 */
app.get("/api/status", async (_req, res) => {
    const result = await runQmd(["status"]);
    if (!result.ok) {
        return res.status(500).json({ error: "Failed to get status", detail: result.stderr });
    }
    res.json({ status: result.stdout });
});

// ─── Converter Routes ─────────────────────────────────────────────────

/**
 * POST /api/converter/watch
 * Body: { path: string }
 * Start watching a directory for .docx/.txt files
 */
app.post("/api/converter/watch", (req, res) => {
    const dirPath = sanitizePath(req.body.path);
    if (!dirPath) return res.status(400).json({ error: "Invalid path" });

    const result = watchDir(dirPath);
    res.json({
        success: true,
        message: result.already ? "Already watching this directory" : "Now watching for .docx/.txt files",
        mirrorDir: result.mirrorDir,
    });
});

/**
 * POST /api/converter/unwatch
 * Body: { path: string }
 * Stop watching a directory
 */
app.post("/api/converter/unwatch", async (req, res) => {
    const dirPath = sanitizePath(req.body.path);
    if (!dirPath) return res.status(400).json({ error: "Invalid path" });

    await unwatchDir(dirPath);
    res.json({ success: true, message: "Stopped watching" });
});

/**
 * GET /api/converter/status
 * List all watched directories
 */
app.get("/api/converter/status", (_req, res) => {
    res.json({ watched: getWatchedDirs() });
});

/**
 * POST /api/converter/convert
 * Body: { file: string, outputDir?: string }
 * Convert a single .docx/.txt file to .md on demand
 */
app.post("/api/converter/convert", async (req, res) => {
    const file = sanitizePath(req.body.file);
    if (!file) return res.status(400).json({ error: "Invalid file path" });

    const outputDir = req.body.outputDir ? sanitizePath(req.body.outputDir) : null;
    const result = await convertFile(file, outputDir);

    if (!result.ok) {
        return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, outputPath: result.outputPath });
});

// ─── Fallback: serve index.html for SPA ───────────────────────────────

app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ────────────────────────────────────────────────────────────

app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  🔍 QMD UI running at http://127.0.0.1:${PORT}\n`);
});
