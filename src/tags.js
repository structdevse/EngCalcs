import { escapeHtml } from "./utils.js";

// Editable tag chips + input, for the sheet header. Calls onAdd/onRemove
// and re-renders itself in place.
export function createTagEditor(tags, onAdd, onRemove) {
  const wrap = document.createElement("div");
  wrap.className = "tag-editor";

  function render() {
    wrap.innerHTML = "";
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.innerHTML = `${escapeHtml(tag)} <button type="button" class="tag-remove" data-tag="${escapeHtml(
        tag
      )}">×</button>`;
      wrap.appendChild(chip);
    });

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tag-input";
    input.placeholder = "+ tag";
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && input.value.trim()) {
        evt.preventDefault();
        onAdd(input.value.trim());
        input.value = "";
        render();
      }
    });
    wrap.appendChild(input);

    wrap.querySelectorAll(".tag-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        onRemove(btn.dataset.tag);
        render();
      });
    });
  }

  render();
  return wrap;
}

// Read-only clickable tag filter chips for the file browser sidebar.
export function createTagFilter(allTags, activeTags, onToggle) {
  const wrap = document.createElement("div");
  wrap.className = "tag-filter";

  allTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-filter-chip";
    chip.textContent = tag;
    chip.classList.toggle("active", activeTags.has(tag));
    chip.addEventListener("click", () => onToggle(tag));
    wrap.appendChild(chip);
  });

  return wrap;
}
