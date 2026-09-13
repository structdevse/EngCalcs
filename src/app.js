import * as state from "./state.js";
import * as drive from "./drive.js";
import * as storage from "./storage.js";
import * as fileBrowser from "./fileBrowser.js";
import * as viewMode from "./viewMode.js";
import { renderBlocks } from "./blocks.js";
import { createStatusDropdown, updateWatermark } from "./status.js";
import { createTagEditor } from "./tags.js";
import { debounce, formatDate } from "./utils.js";
import { AUTOSAVE_DELAY_MS } from "./config.js";

const els = {
  sidebarToggle: document.getElementById("sidebar-toggle"),
  titleInput: document.getElementById("title-input"),
  formalMeta: document.getElementById("formal-meta"),
  viewToggle: document.getElementById("view-toggle"),
  printBtn: document.getElementById("print-btn"),
  statusSlot: document.getElementById("status-slot"),
  tagsSlot: document.getElementById("tags-slot"),
  saveIndicator: document.getElementById("save-indicator"),
  storageModeBadge: document.getElementById("storage-mode-badge"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFileInput: document.getElementById("import-file-input"),
  darkModeToggle: document.getElementById("darkmode-toggle"),
  signinBtn: document.getElementById("signin-btn"),
  sidebar: document.getElementById("sidebar"),
  newSheetBtn: document.getElementById("new-sheet-btn"),
  fileBrowser: document.getElementById("file-browser"),
  blocksContainer: document.getElementById("blocks-container"),
  watermark: document.getElementById("watermark"),
  appBody: document.getElementById("app-body"),
};

// --- dark mode ---
// setThemeAttribute is the low-level piece (DOM attribute + canvas repaint
// signal, no persistence) — reused by formal view below to force a light
// look temporarily without touching the user's actual preference.
function setThemeAttribute(theme) {
  document.documentElement.dataset.theme = theme;
  els.darkModeToggle.textContent = theme === "dark" ? "☀" : "🌙";
  // Lets already-rendered sketch canvases know to repaint with the new
  // theme's colors — a canvas doesn't update on its own like CSS does.
  window.dispatchEvent(new Event("themechange"));
}

function getPreferredTheme() {
  const saved = localStorage.getItem("engnb-theme");
  return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function applyTheme(theme) {
  setThemeAttribute(theme);
}

function initTheme() {
  applyTheme(getPreferredTheme());
}

els.darkModeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("engnb-theme", next);
});

// --- app view / formal view ---
els.viewToggle.addEventListener("click", () => {
  viewMode.setViewMode(viewMode.isFormal() ? "app" : "formal");
});

viewMode.onViewModeChange((mode) => {
  document.documentElement.dataset.viewMode = mode;
  els.viewToggle.textContent = mode === "formal" ? "App view" : "Formal view";
  els.titleInput.readOnly = mode === "formal";
  // Formal view is meant to look like a clean printed calc sheet regardless
  // of the user's dark-mode preference — force light while in it (without
  // persisting that as their real preference), then restore on the way out.
  setThemeAttribute(mode === "formal" ? "light" : getPreferredTheme());
  renderBlocks(els.blocksContainer);
});

// --- print ---
els.printBtn.addEventListener("click", () => {
  viewMode.setViewMode("formal");
  // Let formal view's re-render finish (canvases repaint, chrome hides)
  // before handing off to the browser's print pipeline.
  requestAnimationFrame(() => {
    window.print();
  });
});

// --- sidebar toggle (mobile / more page room) ---
els.sidebarToggle.addEventListener("click", () => {
  els.appBody.classList.toggle("sidebar-collapsed");
});

// --- sheet header rendering ---
function renderHeader() {
  const sheet = state.getSheet();
  if (!sheet) return;

  els.titleInput.value = sheet.title;
  els.formalMeta.textContent = `Created ${formatDate(sheet.created)}  ·  Modified ${formatDate(sheet.modified)}`;

  els.statusSlot.innerHTML = "";
  els.statusSlot.appendChild(
    createStatusDropdown(sheet.status, (status) => state.setStatus(status))
  );

  els.tagsSlot.innerHTML = "";
  els.tagsSlot.appendChild(
    createTagEditor(
      sheet.tags,
      (tag) => state.addTag(tag),
      (tag) => state.removeTag(tag)
    )
  );

  updateWatermark(els.watermark, sheet.status);
}

els.titleInput.addEventListener("input", () => {
  state.setTitle(els.titleInput.value);
});

els.newSheetBtn.addEventListener("click", () => {
  state.newSheet();
});

// --- opening a sheet from the file browser ---
async function openSheet(fileId) {
  els.saveIndicator.textContent = "Loading...";
  try {
    const content = await storage.loadSheetContent(fileId);
    state.loadSheet(content, fileId);
    els.saveIndicator.textContent = "";
  } catch (err) {
    els.saveIndicator.textContent = `Failed to open: ${err.message}`;
  }
}

fileBrowser.initFileBrowser(els.fileBrowser, { onOpenSheet: openSheet });

// --- react to state changes ---
state.on("sheetLoaded", () => {
  renderHeader();
  renderBlocks(els.blocksContainer);
});

const autosave = debounce(async () => {
  if (!storage.isReady()) return;
  const sheet = state.getSheet();
  if (!sheet) return;
  els.saveIndicator.textContent = "Saving...";
  try {
    const fileId = await storage.saveSheet(state.getFileId(), sheet);
    if (fileId !== state.getFileId()) state.setFileId(fileId);
    const savedLabel = storage.getMode() === "local" ? "Saved locally" : "Saved";
    els.saveIndicator.textContent = `${savedLabel} ${new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    fileBrowser.refreshFileBrowser();
  } catch (err) {
    els.saveIndicator.textContent = `Save failed: ${err.message}`;
  }
}, AUTOSAVE_DELAY_MS);

state.on("sheetChanged", () => {
  renderHeader();
  autosave();
});

// --- storage mode badge ---
function updateStorageModeBadge() {
  const mode = storage.getMode();
  els.storageModeBadge.textContent = mode === "drive" ? "Google Drive" : "Local (this device)";
  els.storageModeBadge.className = `storage-mode-badge mode-${mode}`;
}

storage.onModeChange(() => {
  updateStorageModeBadge();
  // Switching backend means the current sheet's fileId no longer applies
  // to the new backend, so the next autosave should create a fresh entry.
  state.setFileId(null);
  fileBrowser.refreshFileBrowser();
});

// --- Google sign-in ---
function updateSigninButton() {
  els.signinBtn.textContent = drive.isSignedIn() ? "Sign out" : "Sign in with Google";
}

els.signinBtn.addEventListener("click", async () => {
  if (drive.isSignedIn()) {
    drive.signOut();
    storage.setMode("local");
    updateSigninButton();
    return;
  }
  try {
    await drive.signIn();
    storage.setMode("drive");
    updateSigninButton();
  } catch (err) {
    els.saveIndicator.textContent = `Sign-in failed: ${err.message || err.error || "unknown error"}`;
  }
});

drive.onSignedInChange(updateSigninButton);

// --- export / import JSON (works regardless of storage backend) ---
function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

els.exportBtn.addEventListener("click", () => {
  const sheet = state.getSheet();
  if (!sheet) return;
  const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(sheet.title)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

els.importBtn.addEventListener("click", () => {
  els.importFileInput.click();
});

els.importFileInput.addEventListener("change", async () => {
  const file = els.importFileInput.files[0];
  els.importFileInput.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.id || !Array.isArray(parsed.blocks)) {
      throw new Error("File doesn't look like a notebook sheet.");
    }
    state.loadSheet(parsed, null);
  } catch (err) {
    els.saveIndicator.textContent = `Import failed: ${err.message}`;
  }
});

async function waitForGoogleIdentity(timeoutMs = 8000) {
  const start = Date.now();
  while (!(window.google && window.google.accounts)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Google Identity Services failed to load.");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- boot ---
async function boot() {
  initTheme();
  updateSigninButton();
  updateStorageModeBadge();
  fileBrowser.refreshFileBrowser();
  state.newSheet();

  try {
    await waitForGoogleIdentity();
    await drive.initGoogleAuth();
  } catch (err) {
    // Drive being unavailable is non-fatal — the app already runs on the
    // local storage backend, so just note it quietly in the indicator.
    els.saveIndicator.textContent = err.message;
  }
}

boot();
