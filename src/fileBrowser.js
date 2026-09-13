import * as storage from "./storage.js";
import { formatDate, highlightMatch } from "./utils.js";
import { createStatusBadge } from "./status.js";
import { createTagFilter } from "./tags.js";

let index = []; // [{id, title, tags, status, modified, textContent}]
let searchQuery = "";
let activeTags = new Set();
let els = null;
let openCallback = null;
let deleteCallback = null;

export function initFileBrowser(container, { onOpenSheet, onDeleteSheet }) {
  openCallback = onOpenSheet;
  deleteCallback = onDeleteSheet;

  container.innerHTML = "";

  const search = document.createElement("input");
  search.type = "text";
  search.className = "sidebar-search";
  search.placeholder = "Search sheets, tags, text...";
  search.addEventListener("input", () => {
    searchQuery = search.value.trim().toLowerCase();
    renderList();
  });

  const tagFilterWrap = document.createElement("div");
  tagFilterWrap.className = "sidebar-tag-filter-wrap";

  const listEl = document.createElement("div");
  listEl.className = "sidebar-list";

  const statusEl = document.createElement("div");
  statusEl.className = "sidebar-status";

  container.appendChild(search);
  container.appendChild(tagFilterWrap);
  container.appendChild(listEl);
  container.appendChild(statusEl);

  els = { search, tagFilterWrap, listEl, statusEl };
}

export async function refreshFileBrowser() {
  if (!els) return;
  if (!storage.isReady()) {
    els.statusEl.textContent = "Sign in to Google Drive to see saved sheets.";
    index = [];
    renderList();
    return;
  }
  els.statusEl.textContent = "Loading sheets...";
  try {
    const files = await storage.listSheetFiles();
    const loaded = await Promise.all(
      files.map(async (f) => {
        try {
          const content = await storage.loadSheetContent(f.id);
          return {
            id: f.id,
            title: content.title || f.name,
            tags: content.tags || [],
            status: content.status || "draft",
            modified: content.modified || f.modifiedTime,
            textContent: (content.blocks || [])
              .filter((b) => b.type === "text")
              .map((b) => b.content || "")
              .join(" "),
          };
        } catch {
          return null;
        }
      })
    );
    index = loaded.filter(Boolean);
    els.statusEl.textContent = "";
  } catch (err) {
    els.statusEl.textContent = `Failed to load sheets: ${err.message}`;
  }
  renderList();
}

function allTags() {
  const set = new Set();
  index.forEach((s) => s.tags.forEach((t) => set.add(t)));
  return [...set].sort();
}

function matchesQuery(sheet) {
  if (!searchQuery) return true;
  return (
    sheet.title.toLowerCase().includes(searchQuery) ||
    sheet.tags.some((t) => t.toLowerCase().includes(searchQuery)) ||
    sheet.textContent.toLowerCase().includes(searchQuery)
  );
}

function matchesTagFilter(sheet) {
  if (activeTags.size === 0) return true;
  return [...activeTags].every((t) => sheet.tags.includes(t));
}

function renderList() {
  if (!els) return;

  els.tagFilterWrap.innerHTML = "";
  const tags = allTags();
  if (tags.length > 0) {
    els.tagFilterWrap.appendChild(
      createTagFilter(tags, activeTags, (tag) => {
        if (activeTags.has(tag)) activeTags.delete(tag);
        else activeTags.add(tag);
        renderList();
      })
    );
  }

  const filtered = index.filter((s) => matchesQuery(s) && matchesTagFilter(s));

  els.listEl.innerHTML = "";
  if (index.length === 0) {
    els.listEl.innerHTML =
      '<div class="sidebar-empty">No sheets yet — create one to get started.</div>';
    return;
  }
  if (filtered.length === 0) {
    els.listEl.innerHTML = '<div class="sidebar-empty">No sheets match.</div>';
    return;
  }

  filtered
    .slice()
    .sort((a, b) => new Date(b.modified) - new Date(a.modified))
    .forEach((sheet) => {
      const item = document.createElement("div");
      item.className = "sidebar-item";
      item.innerHTML = `
        <div class="sidebar-item-title">${highlightMatch(sheet.title, searchQuery)}</div>
        <div class="sidebar-item-meta">${formatDate(sheet.modified)}</div>
        <div class="sidebar-item-tags"></div>
      `;
      const badgeSlot = document.createElement("div");
      badgeSlot.className = "sidebar-item-badge";
      badgeSlot.appendChild(createStatusBadge(sheet.status));
      item.appendChild(badgeSlot);

      const tagsEl = item.querySelector(".sidebar-item-tags");
      sheet.tags.forEach((tag) => {
        const t = document.createElement("span");
        t.className = "sidebar-item-tag";
        t.innerHTML = highlightMatch(tag, searchQuery);
        tagsEl.appendChild(t);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "sidebar-item-delete";
      deleteBtn.textContent = "×";
      deleteBtn.title = "Delete this sheet";
      deleteBtn.addEventListener("click", async (evt) => {
        evt.stopPropagation(); // don't also open the sheet
        if (!confirm(`Delete "${sheet.title}"? This can't be undone.`)) return;
        try {
          await storage.deleteSheet(sheet.id);
          if (deleteCallback) deleteCallback(sheet.id);
          refreshFileBrowser();
        } catch (err) {
          els.statusEl.textContent = `Failed to delete: ${err.message}`;
        }
      });
      item.appendChild(deleteBtn);

      item.addEventListener("click", () => openCallback(sheet.id));
      els.listEl.appendChild(item);
    });
}
