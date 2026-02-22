/* ═══════════════════════════════════════════════════════════════
   QMD UI — .docx / .txt File Converter
   ═══════════════════════════════════════════════════════════════
   Watches collection directories for .docx files and converts
   them to .md so qmd can index them. Also copies .txt → .md.

   Usage:
     import { startConverter } from './converter.js';
     startConverter();   // reads collection paths from qmd
   ═══════════════════════════════════════════════════════════════ */

import chokidar from "chokidar";
import mammoth from "mammoth";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Mirror directory for converted files — sits alongside originals
const MIRROR_SUFFIX = "_qmd_converted";

/** Get active collection paths from qmd */
async function getCollectionPaths() {
    try {
        const { stdout } = await execFileAsync("qmd", ["collection", "list"], {
            timeout: 10_000,
        });
        // Parse paths from "name (qmd://name/)" blocks
        // The path is on the line after the collection header — we need to look at
        // the qmd source paths which aren't directly in `collection list`.
        // Instead we'll return an empty array and let the user configure paths via API.
        return [];
    } catch {
        return [];
    }
}

/** Convert a .docx file to .md using mammoth */
async function convertDocx(srcPath, destPath) {
    try {
        const buffer = await fs.readFile(srcPath);
        const result = await mammoth.convertToMarkdown({ buffer });

        // Prepend a source reference
        const header = `<!-- Converted from: ${path.basename(srcPath)} -->\n\n`;
        const markdown = header + result.value;

        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, markdown, "utf-8");

        if (result.messages.length > 0) {
            console.log(`  ⚠ Warnings for ${path.basename(srcPath)}:`, result.messages.map((m) => m.message).join(", "));
        }

        return true;
    } catch (err) {
        console.error(`  ✗ Failed to convert ${path.basename(srcPath)}:`, err.message);
        return false;
    }
}

/** Copy a .txt file as .md */
async function convertTxt(srcPath, destPath) {
    try {
        const content = await fs.readFile(srcPath, "utf-8");
        const header = `<!-- Converted from: ${path.basename(srcPath)} -->\n\n`;
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, header + content, "utf-8");
        return true;
    } catch (err) {
        console.error(`  ✗ Failed to copy ${path.basename(srcPath)}:`, err.message);
        return false;
    }
}

/** Compute the mirror path for a source file */
function getMirrorPath(watchDir, filePath) {
    const mirrorDir = watchDir.replace(/\/?$/, MIRROR_SUFFIX);
    const relative = path.relative(watchDir, filePath);
    const parsed = path.parse(relative);
    return path.join(mirrorDir, parsed.dir, parsed.name + ".md");
}

/** Start watching a single directory */
function watchDirectory(dirPath) {
    const watcher = chokidar.watch(dirPath, {
        ignored: [
            /(^|[\/\\])\./,           // dotfiles
            /node_modules/,
            new RegExp(MIRROR_SUFFIX), // don't watch mirror dirs
        ],
        persistent: true,
        ignoreInitial: false,        // process existing files on startup
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 200,
        },
    });

    const processFile = async (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== ".docx" && ext !== ".txt") return;

        const mirrorPath = getMirrorPath(dirPath, filePath);
        const relName = path.relative(dirPath, filePath);

        if (ext === ".docx") {
            console.log(`  📄 Converting: ${relName}`);
            const ok = await convertDocx(filePath, mirrorPath);
            if (ok) console.log(`  ✓ → ${path.relative(dirPath, mirrorPath)}`);
        } else if (ext === ".txt") {
            console.log(`  📝 Copying: ${relName}`);
            const ok = await convertTxt(filePath, mirrorPath);
            if (ok) console.log(`  ✓ → ${path.relative(dirPath, mirrorPath)}`);
        }
    };

    watcher
        .on("add", processFile)
        .on("change", processFile)
        .on("unlink", async (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            if (ext !== ".docx" && ext !== ".txt") return;
            const mirrorPath = getMirrorPath(dirPath, filePath);
            try {
                await fs.unlink(mirrorPath);
                console.log(`  🗑 Removed mirror: ${path.relative(dirPath, mirrorPath)}`);
            } catch {
                // mirror didn't exist, that's fine
            }
        })
        .on("error", (err) => {
            console.error(`  ✗ Watcher error on ${dirPath}:`, err.message);
        });

    return watcher;
}

// ─── Exported API ─────────────────────────────────────────────

const activeWatchers = new Map(); // dirPath → watcher

/**
 * Start watching a directory for .docx/.txt files.
 * Converts them to .md in a sibling mirror directory.
 * @param {string} dirPath - Absolute path to watch
 * @returns {{ mirrorDir: string }} Info about the mirror directory
 */
export function watchDir(dirPath) {
    const resolved = path.resolve(dirPath);
    if (activeWatchers.has(resolved)) {
        return { mirrorDir: resolved.replace(/\/?$/, MIRROR_SUFFIX), already: true };
    }

    console.log(`\n  👁 Watching: ${resolved}`);
    const watcher = watchDirectory(resolved);
    activeWatchers.set(resolved, watcher);

    const mirrorDir = resolved.replace(/\/?$/, MIRROR_SUFFIX);
    return { mirrorDir, already: false };
}

/**
 * Stop watching a directory.
 * @param {string} dirPath
 */
export async function unwatchDir(dirPath) {
    const resolved = path.resolve(dirPath);
    const watcher = activeWatchers.get(resolved);
    if (watcher) {
        await watcher.close();
        activeWatchers.delete(resolved);
        console.log(`  ⏹ Stopped watching: ${resolved}`);
    }
}

/**
 * Get list of currently watched directories.
 */
export function getWatchedDirs() {
    return Array.from(activeWatchers.keys()).map((dir) => ({
        path: dir,
        mirrorDir: dir.replace(/\/?$/, MIRROR_SUFFIX),
    }));
}

/**
 * Convert a single file on-demand (without watching).
 * @param {string} filePath - Absolute path to .docx or .txt
 * @param {string} outputDir - Directory to save the .md file
 * @returns {Promise<{ok: boolean, outputPath?: string, error?: string}>}
 */
export async function convertFile(filePath, outputDir) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".docx" && ext !== ".txt") {
        return { ok: false, error: "Unsupported file type. Only .docx and .txt are supported." };
    }

    const parsed = path.parse(filePath);
    const outputPath = path.join(outputDir || path.dirname(filePath), parsed.name + ".md");

    let ok;
    if (ext === ".docx") {
        ok = await convertDocx(filePath, outputPath);
    } else {
        ok = await convertTxt(filePath, outputPath);
    }

    return ok
        ? { ok: true, outputPath }
        : { ok: false, error: `Failed to convert ${path.basename(filePath)}` };
}
