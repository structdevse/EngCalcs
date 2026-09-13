// Tracks app-view vs formal-view. Purely a client-side presentation
// switch — never written to the sheet JSON, never affects the saved file.

let mode = "app"; // "app" | "formal"
let listeners = [];

// Set once, at boot, for the read-only shared-link viewer — unlike the
// app/formal toggle above (a look the owner can freely switch), this is a
// one-way lock: a recipient can still flip between app/formal styling, but
// nothing ever makes their view editable again. Kept as a separate flag
// rather than folded into `mode` so blocks.js can gate editability on
// "formal OR locked" while the two stay independently togglable.
let locked = false;

export function lockReadOnly() {
  locked = true;
}

export function isLocked() {
  return locked;
}

export function getViewMode() {
  return mode;
}

export function isFormal() {
  return mode === "formal";
}

export function setViewMode(next) {
  if (next === mode) return;
  mode = next;
  listeners.forEach((fn) => fn(mode));
}

export function onViewModeChange(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}
