import * as state from "./state.js";
import { createTextBlock } from "./textBlock.js";
import { createSketchBlock } from "./sketch.js";
import { createImageBlock } from "./imageBlock.js";
import { uuid } from "./utils.js";
import * as viewMode from "./viewMode.js";

// Set right before a render to open that one text block already in edit
// mode (used when a block was just added by the user).
let focusBlockId = null;

// The block currently "cut" and awaiting a paste target — an alternative to
// dragging for moving something a long way down/up a tall sheet, where
// dragging (even with auto-scroll) can feel clunky. Reordering is just
// state.moveBlock either way; cut/paste and drag are two front ends onto
// the same operation.
let cutBlockId = null;

// Gathers every tooltip trigger currently in the sheet as a candidate for
// the "link to existing" list — both already-shared ([trigger]{{id}}) and
// legacy, still-private ([trigger]{text}) ones created before linking
// existed or never touched since. Returned WITH trigger text (what the
// user actually recognizes from reading their own document) rather than
// just tooltip content, since richTextEditor.js's popup shows that as the
// primary label — see its comment for why, and for how it decides when a
// trigger needs its tooltip text shown alongside it to disambiguate.
// Picking a "legacy" one promotes it into the shared library at that
// moment (reusing the same "type new text" path, since seeding a fresh
// shared entry with existing text is exactly that).
function collectTooltipCandidates() {
  const sheet = state.getSheet();
  const tooltips = state.getTooltips();
  const candidates = [];
  const seen = new Set();
  const linkedPattern = /\[([^\]]+)\]\{\{([^}]+)\}\}/g;
  // Negative lookahead excludes {{id}} (already handled above) from also
  // matching here as if it were literal text "{id}".
  const literalPattern = /\[([^\]]+)\]\{(?!\{)([^}]+)\}/g;

  sheet.blocks.forEach((b) => {
    if (b.type !== "text" || !b.content) return;

    let match;
    linkedPattern.lastIndex = 0;
    while ((match = linkedPattern.exec(b.content)) !== null) {
      const [, triggerText, id] = match;
      const key = `id:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ triggerText, tooltipText: tooltips[id] || "", kind: "id", id });
    }

    literalPattern.lastIndex = 0;
    while ((match = literalPattern.exec(b.content)) !== null) {
      const [, triggerText, tooltipText] = match;
      const key = `legacy:${triggerText}|||${tooltipText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ triggerText, tooltipText, kind: "legacy" });
    }
  });

  return candidates;
}

// Renders the block list for the current sheet into `container`, and wires
// up add/reorder/delete. Call renderBlocks() again after loading a new sheet.
export function renderBlocks(container) {
  container.innerHTML = "";
  const sheet = state.getSheet();
  if (!sheet) return;

  if (cutBlockId && !sheet.blocks.some((b) => b.id === cutBlockId)) {
    cutBlockId = null; // the cut block was deleted — nothing to paste anymore
  }
  const cutIndex = cutBlockId ? sheet.blocks.findIndex((b) => b.id === cutBlockId) : -1;

  // A slot's target index is its position among the OTHER blocks only,
  // matching what state.moveBlock expects (it removes the cut block first,
  // then inserts at this index into what remains).
  function targetIndexForSlot(index) {
    return cutIndex >= 0 && index > cutIndex ? index - 1 : index;
  }

  function buildPasteSlot(index) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "paste-slot";
    slot.textContent = "Paste here";
    slot.addEventListener("click", () => {
      state.moveBlock(cutBlockId, targetIndexForSlot(index));
      cutBlockId = null;
      renderBlocks(container);
    });
    return slot;
  }

  function buildCutBanner() {
    const banner = document.createElement("div");
    banner.className = "cut-banner";
    const label = document.createElement("span");
    label.textContent = "Block cut — click “Paste here” below where you want it.";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cut-banner-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      cutBlockId = null;
      renderBlocks(container);
    });
    banner.appendChild(label);
    banner.appendChild(cancelBtn);
    return banner;
  }

  // Formal view is the owner's own toggle (freely reversible); locked is
  // the one-way shared-link-viewer state. Either one means no editing.
  const readOnly = viewMode.isFormal() || viewMode.isLocked();

  if (cutBlockId && !readOnly) {
    container.appendChild(buildCutBanner());
  }

  // A slot immediately before or after the cut block's own current spot
  // would be a no-op move, so it's skipped rather than shown as a dead click.
  let previousWasCutBlock = false;
  sheet.blocks.forEach((block, index) => {
    const isCutBlock = block.id === cutBlockId;
    if (cutBlockId && !readOnly && !isCutBlock && !previousWasCutBlock) {
      container.appendChild(buildPasteSlot(index));
    }
    container.appendChild(renderBlock(block));
    previousWasCutBlock = isCutBlock;
  });
  if (cutBlockId && !readOnly && !previousWasCutBlock) {
    container.appendChild(buildPasteSlot(sheet.blocks.length));
  }

  focusBlockId = null;

  if (!readOnly) {
    container.appendChild(buildAddBar());
  }
}

function renderBlock(block) {
  const row = document.createElement("div");
  row.className = "block-row";
  row.dataset.blockId = block.id;
  if (block.id === cutBlockId) row.classList.add("cut");

  const readOnly = viewMode.isFormal() || viewMode.isLocked();

  let handle = null;
  if (!readOnly) {
    handle = document.createElement("div");
    handle.className = "block-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    row.appendChild(handle);
  }

  const body = document.createElement("div");
  body.className = "block-body";

  if (block.type === "sketch") {
    block.operations = block.operations || [];
    body.appendChild(
      createSketchBlock(
        block,
        () => {
          state.updateBlock(block.id, {
            operations: block.operations,
            width: block.width,
            height: block.height,
          });
        },
        { readOnly }
      )
    );
  } else if (block.type === "image") {
    body.appendChild(
      createImageBlock(
        block,
        () => {
          state.updateBlock(block.id, { src: block.src, width: block.width });
        },
        { readOnly }
      )
    );
  } else {
    body.appendChild(
      createTextBlock(
        block,
        () => {
          // Text blocks can change more than just content now (font,
          // manual height), so this re-syncs from the live block object
          // rather than taking a single value — same pattern sketch and
          // image blocks use.
          state.updateBlock(block.id, {
            content: block.content,
            font: block.font,
            height: block.height,
          });
        },
        {
          autoFocus: block.id === focusBlockId,
          readOnly,
          tooltips: state.getTooltips(),
          tooltipCandidates: collectTooltipCandidates(),
          onCreateTooltip: (text) => state.createTooltip(text),
          onUpdateTooltip: (id, text) => state.setTooltip(id, text),
        }
      )
    );
  }
  row.appendChild(body);

  if (!readOnly) {
    const cutBtn = document.createElement("button");
    cutBtn.type = "button";
    cutBtn.className = "block-cut";
    const isCut = block.id === cutBlockId;
    cutBtn.textContent = isCut ? "Cancel" : "Cut";
    cutBtn.title = isCut ? "Cancel move" : "Cut — pick where to paste it, no dragging needed";
    cutBtn.addEventListener("click", () => {
      cutBlockId = isCut ? null : block.id;
      renderBlocks(row.parentElement);
    });
    row.appendChild(cutBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "block-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Delete block";
    removeBtn.addEventListener("click", () => {
      if (!confirm("Delete this block?")) return;
      state.removeBlock(block.id);
      row.remove();
    });
    row.appendChild(removeBtn);

    wireDragAndDrop(row, handle);
  }

  return row;
}

function buildAddBar() {
  const bar = document.createElement("div");
  bar.className = "add-block-bar";

  const addText = document.createElement("button");
  addText.type = "button";
  addText.className = "add-block-btn";
  addText.textContent = "+ Text block";
  addText.addEventListener("click", () => {
    const block = state.addBlock({ id: uuid(), type: "text", content: "" });
    focusBlockId = block.id;
    rerenderFrom(bar);
  });

  const addSketch = document.createElement("button");
  addSketch.type = "button";
  addSketch.className = "add-block-btn";
  addSketch.textContent = "+ Sketch block";
  addSketch.addEventListener("click", () => {
    state.addBlock({ id: uuid(), type: "sketch", operations: [] });
    rerenderFrom(bar);
  });

  const addImage = document.createElement("button");
  addImage.type = "button";
  addImage.className = "add-block-btn";
  addImage.textContent = "+ Image block";
  addImage.addEventListener("click", () => {
    state.addBlock({ id: uuid(), type: "image", src: null });
    rerenderFrom(bar);
  });

  bar.appendChild(addText);
  bar.appendChild(addSketch);
  bar.appendChild(addImage);
  return bar;
}

function rerenderFrom(barEl) {
  const container = barEl.parentElement;
  renderBlocks(container);
}

// Pointer-based reordering (not native HTML5 drag-and-drop): the drag
// target is a small handle, and native drag has two real problems here —
// it doesn't fire at all on touch devices, and a pointer-capture-based
// gesture tolerates the cursor drifting off the handle mid-drag, which a
// small native drag source does not. A thin insertion-line indicator shows
// exactly where the block will land, computed the same way regardless of
// drag direction (see the index math in onPointerUp below).

const SCROLL_EDGE_SIZE = 70; // px from the scroll container's edge that triggers auto-scroll
const SCROLL_MAX_SPEED = 16; // px per frame right at the edge

function wireDragAndDrop(row, handle) {
  handle.addEventListener("pointerdown", (evt) => {
    evt.preventDefault();
    handle.setPointerCapture(evt.pointerId);

    const container = row.parentElement;
    const scrollEl = container.closest("#page") || container;
    const sourceId = row.dataset.blockId;
    const indicator = document.createElement("div");
    indicator.className = "block-drop-indicator";
    let hasMoved = false;
    let lastClientY = null;
    let scrollSpeed = 0;
    let scrollRaf = null;

    row.classList.add("dragging");
    handle.classList.add("grabbing");

    function placeIndicator(clientY) {
      const otherRows = [...container.querySelectorAll(".block-row")].filter((r) => r !== row);
      for (const r of otherRows) {
        const rect = r.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          container.insertBefore(indicator, r);
          return;
        }
      }
      // Below every other row: land just before the add-block bar.
      const addBar = container.querySelector(".add-block-bar");
      container.insertBefore(indicator, addBar);
    }

    // While the cursor rests near the top or bottom edge of the scroll
    // container, keep scrolling toward it — otherwise a block you want to
    // reorder past has to already be on-screen, which defeats the purpose
    // for long text/sketch blocks.
    function updateScrollSpeed(clientY) {
      const rect = scrollEl.getBoundingClientRect();
      const fromTop = clientY - rect.top;
      const fromBottom = rect.bottom - clientY;
      if (fromTop < SCROLL_EDGE_SIZE) {
        scrollSpeed = -SCROLL_MAX_SPEED * (1 - Math.max(fromTop, 0) / SCROLL_EDGE_SIZE);
      } else if (fromBottom < SCROLL_EDGE_SIZE) {
        scrollSpeed = SCROLL_MAX_SPEED * (1 - Math.max(fromBottom, 0) / SCROLL_EDGE_SIZE);
      } else {
        scrollSpeed = 0;
      }
    }

    function scrollStep() {
      if (scrollSpeed !== 0) {
        scrollEl.scrollTop += scrollSpeed;
        // The cursor hasn't moved, but the rows under it have — recompute
        // where the indicator belongs against the new layout.
        if (lastClientY !== null) placeIndicator(lastClientY);
      }
      scrollRaf = requestAnimationFrame(scrollStep);
    }
    scrollRaf = requestAnimationFrame(scrollStep);

    function onMove(moveEvt) {
      hasMoved = true;
      lastClientY = moveEvt.clientY;
      placeIndicator(lastClientY);
      updateScrollSpeed(lastClientY);
    }

    function cleanup() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      cancelAnimationFrame(scrollRaf);
      row.classList.remove("dragging");
      handle.classList.remove("grabbing");
    }

    function onUp() {
      cleanup();
      if (hasMoved && indicator.parentElement) {
        // Count real blocks (excluding the one being moved) ahead of the
        // indicator — that's exactly the index to insert at once the
        // dragged block has been removed from the array.
        let targetIndex = 0;
        for (const child of container.children) {
          if (child === indicator) break;
          if (child.classList.contains("block-row") && child !== row) targetIndex++;
        }
        state.moveBlock(sourceId, targetIndex);
        indicator.remove();
        renderBlocks(container);
      } else {
        indicator.remove();
      }
    }

    function onCancel() {
      cleanup();
      indicator.remove();
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  });
}
