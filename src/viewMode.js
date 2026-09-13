// Tracks app-view vs formal-view. Purely a client-side presentation
// switch — never written to the sheet JSON, never affects the saved file.

let mode = "app"; // "app" | "formal"
let listeners = [];

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
