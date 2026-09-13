import * as drive from "./drive.js";
import * as local from "./localBackend.js";

// Routes sheet persistence to either Drive or the local-storage fallback.
// Everything above this module (app.js, fileBrowser.js) talks to storage.js
// only, so the two backends stay fully interchangeable.

let mode = "local"; // "local" | "drive"
let modeListeners = [];

export function getMode() {
  return mode;
}

export function setMode(newMode) {
  mode = newMode;
  modeListeners.forEach((fn) => fn(mode));
}

export function onModeChange(fn) {
  modeListeners.push(fn);
  return () => {
    modeListeners = modeListeners.filter((f) => f !== fn);
  };
}

export function isReady() {
  return mode === "drive" ? drive.isSignedIn() : true;
}

export function listSheetFiles() {
  return mode === "drive" ? drive.listSheetFiles() : local.listSheetFiles();
}

export function loadSheetContent(id) {
  return mode === "drive" ? drive.loadSheetContent(id) : local.loadSheetContent(id);
}

export function saveSheet(id, sheetObject) {
  return mode === "drive" ? drive.saveSheet(id, sheetObject) : local.saveSheet(id, sheetObject);
}

export function deleteSheet(id) {
  return mode === "drive" ? drive.deleteSheet(id) : local.deleteSheet(id);
}
