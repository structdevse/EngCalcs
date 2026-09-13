// A same-shape stand-in for drive.js, backing sheets with localStorage
// instead of Google Drive. Used when Drive isn't signed in (including
// "can't sign in right now"), so the notebook is never blocked on Google.
// Each sheet's id doubles as its storage key, matching Drive's fileId role.

const PREFIX = "engnb-sheet-";

function key(id) {
  return PREFIX + id;
}

export function listSheetFiles() {
  const files = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const sheet = JSON.parse(localStorage.getItem(k));
      files.push({
        id: k.slice(PREFIX.length),
        name: sheet.title,
        modifiedTime: sheet.modified,
      });
    } catch {
      // skip unreadable entries
    }
  }
  return Promise.resolve(files);
}

export function loadSheetContent(id) {
  const raw = localStorage.getItem(key(id));
  if (!raw) return Promise.reject(new Error("Sheet not found in local storage."));
  return Promise.resolve(JSON.parse(raw));
}

export function saveSheet(id, sheetObject) {
  const finalId = id || sheetObject.id;
  try {
    localStorage.setItem(key(finalId), JSON.stringify(sheetObject));
  } catch (err) {
    return Promise.reject(new Error("Local storage save failed: " + err.message));
  }
  return Promise.resolve(finalId);
}

export function deleteSheet(id) {
  localStorage.removeItem(key(id));
  return Promise.resolve();
}
