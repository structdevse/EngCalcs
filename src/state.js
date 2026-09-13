import { uuid, nowIso } from "./utils.js";

// Central state for the currently open sheet, plus a tiny pub/sub so UI
// modules can react to changes without importing each other directly.

const listeners = {
  sheetChanged: [],   // sheet content mutated (blocks/title/tags/status)
  sheetLoaded: [],     // a whole new sheet became current
  driveFileId: [],     // the sheet's Drive file id changed (first save)
  tooltipsChanged: [], // the shared tooltip library changed (app.js re-renders every block, since a linked tooltip's text can appear in any of them)
};

let current = null;    // the in-memory sheet object
let currentFileId = null; // Drive file id, or null if never saved

export function on(event, fn) {
  listeners[event].push(fn);
  return () => {
    const i = listeners[event].indexOf(fn);
    if (i >= 0) listeners[event].splice(i, 1);
  };
}

function emit(event, payload) {
  for (const fn of listeners[event]) fn(payload);
}

export function newSheet(title = "Untitled sheet") {
  current = {
    id: uuid(),
    title,
    created: nowIso(),
    modified: nowIso(),
    status: "draft",
    tags: [],
    linkedSheets: [],
    blocks: [],
    tooltips: {}, // shared tooltip library — { [id]: text }, see setTooltip/getTooltips
  };
  currentFileId = null;
  emit("sheetLoaded", current);
  return current;
}

export function loadSheet(sheetData, fileId) {
  current = sheetData;
  currentFileId = fileId;
  emit("sheetLoaded", current);
}

export function getSheet() {
  return current;
}

export function getFileId() {
  return currentFileId;
}

export function setFileId(fileId) {
  currentFileId = fileId;
  emit("driveFileId", fileId);
}

function touch() {
  current.modified = nowIso();
  emit("sheetChanged", current);
}

export function setTitle(title) {
  current.title = title;
  touch();
}

export function setStatus(status) {
  current.status = status;
  touch();
}

export function addTag(tag) {
  tag = tag.trim();
  if (!tag || current.tags.includes(tag)) return;
  current.tags.push(tag);
  touch();
}

export function removeTag(tag) {
  current.tags = current.tags.filter((t) => t !== tag);
  touch();
}

export function addBlock(block, atIndex = current.blocks.length) {
  block.id = block.id || uuid();
  current.blocks.splice(atIndex, 0, block);
  touch();
  return block;
}

export function updateBlock(blockId, patch) {
  const block = current.blocks.find((b) => b.id === blockId);
  if (!block) return;
  Object.assign(block, patch);
  touch();
}

export function removeBlock(blockId) {
  current.blocks = current.blocks.filter((b) => b.id !== blockId);
  touch();
}

export function moveBlock(blockId, toIndex) {
  const fromIndex = current.blocks.findIndex((b) => b.id === blockId);
  if (fromIndex < 0) return;
  const [block] = current.blocks.splice(fromIndex, 1);
  current.blocks.splice(toIndex, 0, block);
  touch();
}

// Shared tooltip library, scoped to this sheet — a linked tooltip trigger
// (anywhere in any text block) stores an id referencing an entry here
// instead of its own private text, so editing the entry updates every
// trigger that links to it. A sheet saved before this feature existed has
// no `tooltips` field at all; lazily creating it here (rather than only in
// newSheet()) means an old, freshly-loaded sheet still works correctly the
// first time a tooltip is linked in it.
export function getTooltips() {
  if (!current.tooltips) current.tooltips = {};
  return current.tooltips;
}

export function setTooltip(id, text) {
  getTooltips()[id] = text;
  current.modified = nowIso();
  emit("sheetChanged", current);
  emit("tooltipsChanged", current);
}

export function createTooltip(text) {
  const id = uuid();
  setTooltip(id, text);
  return id;
}
