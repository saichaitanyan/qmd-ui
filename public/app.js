/* ═══════════════════════════════════════════════════════════════
   QMD UI — Application Logic v2
   ═══════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────
let collections = [];
let activeCollection = null;
let isSearching = false;
let searchAbortController = null;

// ─── DOM Refs ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
    searchInput: $("searchInput"),
    searchHero: $("searchHero"),
    btnFast: $("btnFast"),
    btnDeep: $("btnDeep"),
    collectionPills: $("collectionPills"),
    resultsGrid: $("resultsGrid"),
    resultsMeta: $("resultsMeta"),
    resultsCount: $("resultsCount"),
    resultsModeBadge: $("resultsModeBadge"),
    resultsTime: $("resultsTime"),
    searchLoading: $("searchLoading"),
    loadingText: $("loadingText"),
    emptyState: $("emptyState"),
    welcomeState: $("welcomeState"),
    statusDot: $("statusDot"),
    statusBtn: $("statusBtn"),
    statusLabel: $("statusLabel"),
    themeToggle: $("themeToggle"),
    themeIcon: $("themeIcon"),
    collectionList: $("collectionList"),
    collectionCount: $("collectionCount"),
    addCollectionForm: $("addCollectionForm"),
    collectionFeedback: $("collectionFeedback"),
    collectionAlert: $("collectionAlert"),
    btnEmbed: $("btnEmbed"),
    footerCollections: $("footerCollections"),
    footerDocs: $("footerDocs"),
};

// ─── Theme ──────────────────────────────────────────────────────
function getStoredTheme() {
    return localStorage.getItem("qmd-theme") || "dark";
}

function setTheme(theme) {
    document.documentElement.setAttribute("data-bs-theme", theme);
    localStorage.setItem("qmd-theme", theme);
    dom.themeIcon.className = theme === "dark" ? "bi bi-moon-stars-fill" : "bi bi-sun-fill";
}

dom.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-bs-theme");
    setTheme(current === "dark" ? "light" : "dark");
});

setTheme(getStoredTheme());

// ─── API ────────────────────────────────────────────────────────
async function api(endpoint, options = {}) {
    const res = await fetch(`/api${endpoint}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ─── Collections ────────────────────────────────────────────────
async function loadCollections() {
    try {
        const data = await api("/collections");
        collections = data.collections || [];
        renderPills();
        renderCollectionList();
        dom.statusDot.classList.add("online");
        dom.statusLabel.textContent = `${collections.length} collection${collections.length !== 1 ? "s" : ""}`;

        // Footer stats
        const totalFiles = collections.reduce((s, c) => s + c.files, 0);
        dom.footerCollections.textContent = `${collections.length} collections`;
        dom.footerDocs.textContent = `${totalFiles} docs indexed`;

        // QMD version (for About modal)
        try {
            const status = await api("/status");
            const versionMatch = (status.output || "").match(/qmd\s+([\d.]+)/i);
            const versionEl = $("qmdVersion");
            if (versionMatch && versionEl) versionEl.textContent = `v${versionMatch[1]}`;
            else if (versionEl) versionEl.textContent = "";
        } catch { /* non-critical */ }
    } catch {
        dom.statusDot.classList.remove("online");
        dom.statusLabel.textContent = "Offline";
        showToast("Could not connect to QMD", "danger");
    }
}

function renderPills() {
    const totalFiles = collections.reduce((s, c) => s + c.files, 0);
    let html = `<button class="pill ${activeCollection === null ? "active" : ""}" data-col="">
    <i class="bi bi-grid-3x3-gap"></i> All <span class="pill-count">${totalFiles}</span>
  </button>`;

    for (const c of collections) {
        const isActive = activeCollection === c.name;
        html += `<button class="pill ${isActive ? "active" : ""}" data-col="${esc(c.name)}">
      <i class="bi bi-folder2"></i> ${esc(c.name)} <span class="pill-count">${c.files}</span>
    </button>`;
    }

    dom.collectionPills.innerHTML = html;
    dom.collectionPills.querySelectorAll(".pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            activeCollection = btn.dataset.col || null;
            renderPills();
        });
    });
}

function renderCollectionList() {
    dom.collectionCount.textContent = collections.length;

    if (collections.length === 0) {
        dom.collectionList.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem 0;">No collections yet. Add one below.</p>`;
        return;
    }

    dom.collectionList.innerHTML = collections.map((c) => `
    <div class="collection-item">
      <div class="collection-item-info">
        <span class="collection-item-name">${esc(c.name)}</span>
        <span class="collection-item-detail">
          <i class="bi bi-file-earmark"></i> ${c.files} files · ${esc(c.pattern)}
        </span>
      </div>
      <button class="btn-remove" title="Remove" data-remove="${esc(c.name)}">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `).join("");

    dom.collectionList.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const name = btn.dataset.remove;
            if (!confirm(`Remove collection "${name}"? Files won't be deleted.`)) return;
            try {
                await api("/collection/remove", { method: "POST", body: JSON.stringify({ name }) });
                showToast(`"${name}" removed`, "success");
                await loadCollections();
            } catch (err) {
                showToast(`Failed: ${err.message}`, "danger");
            }
        });
    });
}

// ─── Search ─────────────────────────────────────────────────────
function showSearchActions() {
    dom.btnFast.style.display = "";
    dom.btnDeep.style.display = "";
    // Remove any existing cancel button
    const existing = document.querySelector(".search-cancel");
    if (existing) existing.remove();
}

function showCancelButton() {
    dom.btnFast.style.display = "none";
    dom.btnDeep.style.display = "none";
    // Insert cancel button if not already present
    if (!document.querySelector(".search-cancel")) {
        const btn = document.createElement("button");
        btn.className = "search-cancel";
        btn.innerHTML = `<i class="bi bi-x-circle"></i> Cancel`;
        btn.addEventListener("click", cancelSearch);
        document.querySelector(".search-actions").appendChild(btn);
    }
}

function cancelSearch() {
    if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
    }
}

async function doSearch(mode) {
    const q = dom.searchInput.value.trim();
    if (!q || isSearching) return;

    isSearching = true;
    searchAbortController = new AbortController();

    // UI transitions
    dom.welcomeState?.classList.add("d-none");
    dom.searchLoading.classList.remove("d-none");
    dom.resultsGrid.innerHTML = "";
    dom.resultsMeta.classList.add("d-none");
    dom.emptyState.classList.add("d-none");
    dom.loadingText.textContent = mode === "fast" ? "Keyword searching..." : "AI is thinking...";
    showCancelButton();

    const startTime = performance.now();

    try {
        const endpoint = mode === "fast" ? "/search" : "/query";
        const body = { q };
        if (activeCollection) body.collection = activeCollection;

        const data = await api(endpoint, {
            method: "POST",
            body: JSON.stringify(body),
            signal: searchAbortController.signal,
        });
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        renderResults(data.results || [], mode, elapsed);
    } catch (err) {
        if (err.name === "AbortError") {
            showToast("Search cancelled", "warning");
        } else {
            showToast(`Search failed: ${err.message}`, "danger");
        }
    } finally {
        isSearching = false;
        searchAbortController = null;
        dom.searchLoading.classList.add("d-none");
        showSearchActions();
    }
}

function renderResults(results, mode, elapsed) {
    if (results.length === 0) {
        dom.emptyState.classList.remove("d-none");
        return;
    }

    // Header
    dom.resultsMeta.classList.remove("d-none");
    dom.resultsCount.textContent = `${results.length} result${results.length > 1 ? "s" : ""}`;
    dom.resultsTime.textContent = `${elapsed}s`;

    const modeLabel = mode === "fast" ? "⚡ FAST" : "✨ DEEP";
    dom.resultsModeBadge.className = `results-mode-badge ${mode}`;
    dom.resultsModeBadge.textContent = modeLabel;

    // Find max score for bar normalization
    const scores = results.map((r) => r.score ?? 0);
    const maxScore = Math.max(...scores, 0.01);

    dom.resultsGrid.innerHTML = results.map((r, i) => {
        const title = r.title || extractFilename(r.file);
        const snippet = cleanSnippet(r.snippet || "");
        const filePath = r.file || "";
        const score = r.score ?? 0;
        const scorePercent = Math.round((score / maxScore) * 100);
        const collection = extractCollection(filePath);
        const ext = extractExt(filePath);
        const iconClass = getFileIconClass(ext);

        return `
      <div class="result-card" data-file="${escAttr(filePath)}" style="animation-delay:${i * 50}ms">
        <div class="result-card-header">
          <div class="result-title-group">
            <div class="result-file-icon ${iconClass}"><i class="bi ${getFileIcon(ext)}"></i></div>
            <span class="result-title" title="${escAttr(title)}">${esc(title)}</span>
          </div>
          <div class="result-score">
            <div class="result-score-bar"><div class="result-score-fill" style="width:${scorePercent}%"></div></div>
            <span>${score.toFixed(2)}</span>
          </div>
        </div>
        ${snippet ? `<div class="result-snippet">${esc(snippet)}</div>` : ""}
        <div class="result-meta">
          ${collection ? `<span class="result-meta-item"><i class="bi bi-folder2"></i>${esc(collection)}</span>` : ""}
          <span class="result-meta-item"><i class="bi bi-filetype-${ext || "txt"}"></i> .${ext || "?"}</span>
          <span class="result-meta-item"><i class="bi bi-box-arrow-up-right"></i> Open</span>
        </div>
      </div>
    `;
    }).join("");

    dom.resultsGrid.querySelectorAll(".result-card").forEach((card) => {
        card.addEventListener("click", () => openFile(card.dataset.file));
    });
}

async function openFile(file) {
    if (!file) return;
    try {
        await api("/open", { method: "POST", body: JSON.stringify({ file }) });
    } catch (err) {
        showToast(`Could not open: ${err.message}`, "danger");
    }
}

// ─── Add Collection ─────────────────────────────────────────────
dom.addCollectionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("colName").value.trim();
    const colPath = $("colPath").value.trim();
    const mask = $("colMask").value.trim() || "**/*.md";

    if (!name || !colPath) {
        showCollectionFeedback("Name and path are required", "warning");
        return;
    }

    try {
        const data = await api("/collection/add", {
            method: "POST",
            body: JSON.stringify({ name, path: colPath, mask }),
        });
        showCollectionFeedback(data.message || "Collection added!", "success");
        dom.addCollectionForm.reset();
        $("colMask").value = "**/*.md";
        await loadCollections();
    } catch (err) {
        showCollectionFeedback(`Error: ${err.message}`, "danger");
    }
});

function showCollectionFeedback(msg, type) {
    dom.collectionFeedback.classList.remove("d-none");
    dom.collectionAlert.className = `alert alert-${type}`;
    dom.collectionAlert.textContent = msg;
    setTimeout(() => dom.collectionFeedback.classList.add("d-none"), 4000);
}

// ─── Embed ──────────────────────────────────────────────────────
dom.btnEmbed.addEventListener("click", async () => {
    dom.btnEmbed.disabled = true;
    dom.btnEmbed.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Embedding...`;
    try {
        await api("/embed", { method: "POST" });
        showToast("Embedding complete!", "success");
    } catch (err) {
        showToast(`Embedding failed: ${err.message}`, "danger");
    } finally {
        dom.btnEmbed.disabled = false;
        dom.btnEmbed.innerHTML = `<i class="bi bi-cpu"></i> Re-embed All`;
    }
});

// ─── Keyboard ───────────────────────────────────────────────────
dom.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        doSearch(e.shiftKey ? "deep" : "fast");
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== dom.searchInput) {
        e.preventDefault();
        dom.searchInput.focus();
    }
    if (e.key === "Escape") {
        if (isSearching) {
            cancelSearch();
        } else if (document.activeElement === dom.searchInput) {
            dom.searchInput.blur();
        }
    }
});

dom.btnFast.addEventListener("click", () => doSearch("fast"));
dom.btnDeep.addEventListener("click", () => doSearch("deep"));

// ─── Helpers ────────────────────────────────────────────────────
function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function escAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractFilename(filepath) {
    if (!filepath) return "Unknown";
    const parts = filepath.replace("qmd://", "").split("/");
    return parts[parts.length - 1] || parts[parts.length - 2] || filepath;
}

function extractCollection(filepath) {
    if (!filepath || !filepath.startsWith("qmd://")) return null;
    const inner = filepath.replace("qmd://", "");
    const idx = inner.indexOf("/");
    return idx > 0 ? inner.substring(0, idx) : null;
}

function extractExt(filepath) {
    if (!filepath) return "";
    const name = filepath.split("/").pop() || "";
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.substring(dot + 1).toLowerCase() : "";
}

function getFileIcon(ext) {
    const map = {
        md: "bi-markdown-fill",
        txt: "bi-file-text-fill",
        doc: "bi-file-word-fill",
        docx: "bi-file-word-fill",
        pdf: "bi-file-pdf-fill",
        json: "bi-filetype-json",
        yml: "bi-filetype-yml",
        yaml: "bi-filetype-yml",
    };
    return map[ext] || "bi-file-earmark-text";
}

function getFileIconClass(ext) {
    if (ext === "md") return "icon-md";
    if (ext === "txt") return "icon-txt";
    if (ext === "doc" || ext === "docx") return "icon-doc";
    return "icon-default";
}

function cleanSnippet(snippet) {
    return snippet.replace(/@@ .+? @@\s*(\(.+?\))?\s*\n?/g, "").trim();
}

// ─── Toasts ─────────────────────────────────────────────────────
function showToast(message, type = "info") {
    const id = `toast-${Date.now()}`;
    const icons = {
        success: "bi-check-circle-fill",
        danger: "bi-exclamation-triangle-fill",
        warning: "bi-exclamation-circle-fill",
        info: "bi-info-circle-fill",
    };

    const html = `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert" data-bs-autohide="true" data-bs-delay="4000">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi ${icons[type] || icons.info}"></i>
          ${esc(message)}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>
  `;

    const container = $("toastContainer");
    container.insertAdjacentHTML("beforeend", html);
    const toastEl = $(id);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
}

// ─── Boot ───────────────────────────────────────────────────────
loadCollections();
