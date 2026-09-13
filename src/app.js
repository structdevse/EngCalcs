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
  shareBtn: document.getElementById("share-btn"),
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
  els.titleInput.readOnly = mode === "formal" || viewMode.isLocked();
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
  els.titleInput.readOnly = viewMode.isFormal() || viewMode.isLocked();
  els.formalMeta.textContent = `Created ${formatDate(sheet.created)}  ·  Modified ${formatDate(sheet.modified)}`;

  const readOnly = viewMode.isLocked();

  els.statusSlot.innerHTML = "";
  els.statusSlot.appendChild(
    createStatusDropdown(sheet.status, (status) => state.setStatus(status), { readOnly })
  );

  els.tagsSlot.innerHTML = "";
  els.tagsSlot.appendChild(
    createTagEditor(
      sheet.tags,
      (tag) => state.addTag(tag),
      (tag) => state.removeTag(tag),
      { readOnly }
    )
  );

  updateWatermark(els.watermark, sheet.status);
}

els.titleInput.addEventListener("input", () => {
  state.setTitle(els.titleInput.value);
});

els.newSheetBtn.addEventListener("click", () => {
  state.newSheet();
  // Saved right away (not left to the debounced autosave) so a blank sheet
  // shows up in the sidebar immediately as visible confirmation the click
  // worked — otherwise a fresh "Untitled sheet" looks identical to
  // whatever blank sheet was already on screen, with nothing on screen to
  // show anything happened.
  saveNow();
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

fileBrowser.initFileBrowser(els.fileBrowser, {
  onOpenSheet: openSheet,
  onDeleteSheet: (deletedId) => {
    // The sheet currently open in the editor no longer exists in storage —
    // start a fresh one rather than leaving the editor pointed at a fileId
    // that the next autosave would otherwise just silently recreate.
    if (state.getFileId() === deletedId) {
      state.newSheet();
    }
  },
});

// --- react to state changes ---
state.on("sheetLoaded", () => {
  renderHeader();
  renderBlocks(els.blocksContainer);
});

async function saveNow() {
  if (viewMode.isLocked()) return; // shared-link viewer — never writes back
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
}

const autosave = debounce(saveNow, AUTOSAVE_DELAY_MS);

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
  if (drive.isSignedIn()) {
    els.signinBtn.textContent = "Sign out";
  } else if (drive.wasSignedIn()) {
    // The silent reauth attempt at boot didn't complete (Google's token
    // client insists on trying to open an actual popup even for a silent
    // refresh, which the browser blocks with no user gesture behind it) —
    // so getting back into Drive mode needs one real click. Labeling it
    // "Reconnect" rather than "Sign in with Google" says plainly that
    // there's nothing to re-authorize, just one click to restore the
    // session that already exists.
    els.signinBtn.textContent = "Reconnect to Google Drive";
  } else {
    els.signinBtn.textContent = "Sign in with Google";
  }
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

// --- share (read-only link, no sign-in required for the recipient) ---
els.shareBtn.addEventListener("click", async () => {
  if (storage.getMode() !== "drive" || !drive.isSignedIn()) {
    alert("Sign in with Google Drive first — a share link needs the sheet saved there.");
    return;
  }
  els.saveIndicator.textContent = "Preparing share link...";
  try {
    // A brand-new sheet (or one only ever saved locally before switching to
    // Drive) has no Drive fileId yet — save it now so there's something to
    // share, same file the owner is already looking at either way.
    let fileId = state.getFileId();
    if (!fileId) {
      fileId = await storage.saveSheet(null, state.getSheet());
      state.setFileId(fileId);
    }
    await drive.shareFile(fileId);
    const url = `${location.origin}${location.pathname}?file=${fileId}`;
    await navigator.clipboard.writeText(url);
    els.saveIndicator.textContent = "Share link copied to clipboard!";
  } catch (err) {
    els.saveIndicator.textContent = `Couldn't create share link: ${err.message}`;
  }
});

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

// --- shared read-only viewer (?file=DRIVE_FILE_ID, no sign-in at all) ---
function hideOwnerOnlyChrome() {
  els.sidebar.style.display = "none";
  els.sidebarToggle.style.display = "none";
  els.signinBtn.style.display = "none";
  els.storageModeBadge.style.display = "none";
  els.importBtn.style.display = "none";
  els.shareBtn.style.display = "none";
}

async function bootSharedViewer(fileId) {
  viewMode.lockReadOnly();
  hideOwnerOnlyChrome();
  els.saveIndicator.textContent = "Loading shared sheet...";
  try {
    const content = await drive.loadSheetContentPublic(fileId);
    state.loadSheet(content, fileId);
    els.saveIndicator.textContent = "Read-only shared view";
  } catch (err) {
    els.titleInput.value = "Couldn't load this shared sheet";
    els.saveIndicator.textContent = err.message;
  }
}

// --- boot ---
async function boot() {
  initTheme();

  const sharedFileId = new URLSearchParams(location.search).get("file");
  if (sharedFileId) {
    await bootSharedViewer(sharedFileId);
    return;
  }

  updateSigninButton();
  updateStorageModeBadge();
  fileBrowser.refreshFileBrowser();
  state.newSheet();

  try {
    await waitForGoogleIdentity();
    await drive.initGoogleAuth();
    if (drive.wasSignedIn()) {
      // Best-effort — GIS's token client insists on trying to open an
      // actual popup even for this "silent" request, so with no user
      // gesture behind a boot-time call, browsers routinely block it. When
      // that happens updateSigninButton() (below) falls back to a
      // "Reconnect to Google Drive" button — a real click reliably works,
      // since it carries an actual gesture the popup isn't blocked on.
      const signedIn = await drive.trySilentSignIn();
      if (signedIn) {
        storage.setMode("drive");
      }
      updateSigninButton();
    }
  } catch (err) {
    // Drive being unavailable is non-fatal — the app already runs on the
    // local storage backend, so just note it quietly in the indicator.
    els.saveIndicator.textContent = err.message;
  }
}

boot();
