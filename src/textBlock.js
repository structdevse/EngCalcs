import { renderMathText, findTooltipRanges, TEXT_COLOR_NAMES } from "./render.js";
import { attachResizeHandle } from "./resizeHandle.js";
import { wireTooltipPopups } from "./tooltipPopup.js";

// block.font: undefined/"" = handwriting (default), or one of these keys.
const FONT_OPTIONS = [
  { value: "", label: "Handwriting" },
  { value: "arial", label: "Arial" },
  { value: "calibri", label: "Calibri" },
];
const FONT_CLASSES = ["text-font-arial", "text-font-calibri"];

function applyFontClass(el, font) {
  el.classList.remove(...FONT_CLASSES);
  if (font) el.classList.add(`text-font-${font}`);
}

// Wraps (or, if already wrapped, unwraps) the current selection with the
// given markers — e.g. toggleWrap(textarea, "**", "**") for bold. Used by
// the formatting toolbar; typing the markers by hand works identically
// since it's the same syntax the renderer parses.
function toggleWrap(textarea, before, after) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const beforeSlice = value.slice(Math.max(0, start - before.length), start);
  const afterSlice = value.slice(end, end + after.length);

  if (beforeSlice === before && afterSlice === after) {
    textarea.value =
      value.slice(0, start - before.length) + value.slice(start, end) + value.slice(end + after.length);
    textarea.setSelectionRange(start - before.length, end - before.length);
  } else {
    const selected = value.slice(start, end);
    textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
    textarea.setSelectionRange(start + before.length, end + before.length);
  }
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function wrapSelection(textarea, before, after) {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
  textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// Builds a text block: a textarea for editing, swapped for a rendered
// KaTeX preview while not focused. onChange(content) fires on input.
// Pass autoFocus for a freshly-added block so it opens ready to type.
// Pass readOnly (formal view) to render only the static preview — no
// textarea at all, so there's no click-to-edit path to guard against.
export function createTextBlock(block, onChange, { autoFocus = false, readOnly = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "text-block";

  if (readOnly) {
    const preview = document.createElement("div");
    preview.className = "text-block-preview formal";
    applyFontClass(preview, block.font);
    preview.innerHTML = block.content ? renderMathText(block.content) : "";
    wireTooltipPopups(preview);
    wrap.appendChild(preview);
    return wrap;
  }

  const textarea = document.createElement("textarea");
  textarea.className = "text-block-input";
  textarea.value = block.content || "";
  textarea.placeholder = "Type calculations here... use $x^2/y$ or $$sqrt(x+1)$$ for math";
  textarea.rows = 3;

  const preview = document.createElement("div");
  preview.className = "text-block-preview";
  wireTooltipPopups(preview);

  // Formatting toolbar — mousedown preventDefault stops the button from
  // stealing focus from the textarea, so it never blurs (and reverts to
  // preview) before the click handler gets to read the current selection.
  const toolbar = document.createElement("div");
  toolbar.className = "text-format-toolbar";

  function addFormatBtn(label, className, before, after) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `text-format-btn ${className}`;
    btn.textContent = label;
    btn.addEventListener("mousedown", (evt) => evt.preventDefault());
    btn.addEventListener("click", () => toggleWrap(textarea, before, after));
    toolbar.appendChild(btn);
  }

  addFormatBtn("B", "bold", "**", "**");
  addFormatBtn("I", "italic", "*", "*");
  addFormatBtn("U", "underline", "__", "__");

  const colorSelect = document.createElement("select");
  colorSelect.className = "text-format-color";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Color";
  defaultOpt.disabled = true;
  defaultOpt.hidden = true;
  defaultOpt.selected = true;
  colorSelect.appendChild(defaultOpt);
  TEXT_COLOR_NAMES.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    colorSelect.appendChild(opt);
  });
  colorSelect.addEventListener("change", () => {
    const color = colorSelect.value;
    colorSelect.value = "";
    if (color) wrapSelection(textarea, `{${color}}`, "{/color}");
    textarea.focus();
  });
  toolbar.appendChild(colorSelect);

  const linkBtn = document.createElement("button");
  linkBtn.type = "button";
  linkBtn.className = "text-format-btn link";
  linkBtn.textContent = "Link";
  linkBtn.title = "Turn the selection into a link (or paste/type a bare URL — those link automatically)";
  linkBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
  linkBtn.addEventListener("click", () => {
    const url = prompt("Link URL", "https://");
    if (!url) return;
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    const insertion = selected ? `[${selected}](${url})` : url;
    textarea.value = value.slice(0, start) + insertion + value.slice(end);
    const cursor = start + insertion.length;
    textarea.setSelectionRange(cursor, cursor);
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  toolbar.appendChild(linkBtn);

  const tooltipBtn = document.createElement("button");
  tooltipBtn.type = "button";
  tooltipBtn.className = "text-format-btn tooltip-btn";
  tooltipBtn.textContent = "Tip";
  tooltipBtn.title = "Attach a hover tooltip to the selection (can include a link)";
  tooltipBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
  tooltipBtn.addEventListener("click", () => {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const selected = value.slice(start, end);
    if (!selected) {
      alert("Select some text first to attach a tooltip to it.");
      return;
    }
    const tip = prompt('Tooltip text (can include a URL, e.g. "See https://...")', "");
    if (!tip) return;
    const insertion = `[${selected}]{${tip}}`;
    textarea.value = value.slice(0, start) + insertion + value.slice(end);
    const cursor = start + insertion.length;
    textarea.setSelectionRange(cursor, cursor);
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  toolbar.appendChild(tooltipBtn);

  const fontSelect = document.createElement("select");
  fontSelect.className = "text-format-font";
  FONT_OPTIONS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    fontSelect.appendChild(opt);
  });
  fontSelect.value = block.font || "";
  fontSelect.addEventListener("change", () => {
    block.font = fontSelect.value || undefined;
    applyFontClass(textarea, block.font);
    applyFontClass(preview, block.font);
    textarea.focus();
    onChange();
  });
  toolbar.appendChild(fontSelect);

  function autoGrow() {
    if (block.height) return; // manual resize takes over from auto-sizing
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  function applyManualHeight() {
    if (block.height) {
      textarea.style.height = `${block.height}px`;
      preview.style.height = `${block.height}px`;
    } else {
      preview.style.height = "";
    }
  }

  // Whether the toolbar's color/font <select> blurs the textarea when its
  // dropdown opens — and when exactly, relative to the native popup's own
  // state — turns out to vary enough across browsers that reacting to the
  // textarea's OWN blur event (via relatedTarget, or activeElement shortly
  // after) isn't reliable: both approaches collapsed the block at the wrong
  // moment in at least one real browser. Tracking edit-mode via a
  // document-level listener sidesteps that entirely — collapse only when a
  // click or focus change lands outside this block's own DOM (wrap), full
  // stop, regardless of what's happening inside a native dropdown.
  //
  // This listens for "click", not "mousedown": showPreview() below hides
  // the toolbar, which immediately shifts everything below it (including
  // whatever the user is actually trying to click, e.g. "+ Image block")
  // upward as a synchronous side effect. On mousedown, that reflow happens
  // BEFORE the matching mouseup arrives, so mouseup lands on whatever is
  // now under the old coordinates instead — mousedown and mouseup end up
  // targeting different elements, and the browser never fires a click on
  // either one. "click" only fires once mouseup has already resolved
  // against its own target, so a reflow it triggers can't retroactively
  // break a click that's already completed.
  //
  // "focusin" needs the same care for a subtler reason: clicking ANY
  // focusable element (not just a <select>) triggers the browser's own
  // native focus-shift as part of mousedown's default handling — which
  // fires focusin BEFORE mouseup. So a focusin-triggered collapse hits the
  // exact same problem mousedown did: it reflows the page while a click
  // gesture is still mid-flight, and the button the user is trying to hit
  // can shift out from under the pointer before mouseup arrives. Deferring
  // the actual collapse (not just which event triggers it) sidesteps this
  // regardless of which event caused it — showPreview() only ever runs
  // after the current mousedown/click has fully finished resolving.
  function handleOutsideInteraction(evt) {
    if (!wrap.isConnected) {
      document.removeEventListener("focusin", handleOutsideInteraction);
      document.removeEventListener("click", handleOutsideInteraction);
      return;
    }
    if (!wrap.contains(evt.target)) setTimeout(showPreview, 0);
  }

  function showPreview() {
    preview.innerHTML = block.content
      ? renderMathText(block.content)
      : '<span class="text-block-placeholder">Empty block — click to edit</span>';
    preview.hidden = false;
    textarea.hidden = true;
    toolbar.hidden = true;
    applyManualHeight();
    document.removeEventListener("focusin", handleOutsideInteraction);
    document.removeEventListener("click", handleOutsideInteraction);
  }

  function showEditor() {
    preview.hidden = true;
    textarea.hidden = false;
    toolbar.hidden = false;
    autoGrow();
    applyManualHeight();
    textarea.focus();
    // Deferred: showEditor() can run synchronously inside the very click
    // handler that created this block (e.g. "+ Text block"), while that
    // same click event is still bubbling toward document. Attaching the
    // "click" listener immediately would let it catch that same in-flight
    // event and collapse the block right back to preview before it's ever
    // shown. Waiting a tick lets the current click finish dispatching
    // first, so this only reacts to the NEXT click.
    setTimeout(() => {
      document.addEventListener("focusin", handleOutsideInteraction);
      document.addEventListener("click", handleOutsideInteraction);
    }, 0);
  }

  textarea.addEventListener("input", () => {
    block.content = textarea.value;
    autoGrow();
    onChange(block.content);
  });
  preview.addEventListener("click", (evt) => {
    // Let a rendered link navigate, or a tooltip trigger reveal its popup
    // (especially on touch, where tap = focus = show), instead of flipping
    // the block into edit mode underneath the click.
    if (evt.target.closest("a")) return;
    if (evt.target.closest(".text-tooltip-trigger")) return;
    showEditor();
  });

  // Double-clicking a rendered tooltip trigger edits its content in place,
  // without dropping into full raw-text editing. data-tooltip-index (set at
  // render time) and findTooltipRanges (a matching scan over the raw
  // source) are kept in sync by construction — see the comment on
  // renderMathText in render.js.
  preview.addEventListener("dblclick", (evt) => {
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (!trigger) return;
    evt.preventDefault();
    evt.stopPropagation();
    const index = Number(trigger.dataset.tooltipIndex);
    const ranges = findTooltipRanges(block.content || "");
    const range = ranges[index];
    if (!range) return;
    const updated = prompt("Edit tooltip text", range.tooltip);
    if (!updated || updated === range.tooltip) return;
    block.content =
      block.content.slice(0, range.start) +
      `[${range.trigger}]{${updated}}` +
      block.content.slice(range.end);
    textarea.value = block.content;
    showPreview();
    onChange(block.content);
  });

  const contentWrap = document.createElement("div");
  contentWrap.className = "text-block-content";
  contentWrap.appendChild(textarea);
  contentWrap.appendChild(preview);

  attachResizeHandle(contentWrap, {
    axis: "vertical",
    minHeightFloor: 48,
    onResize: (_width, height) => {
      textarea.style.height = `${height}px`;
      preview.style.height = `${height}px`;
    },
    onResizeEnd: (_width, height) => {
      block.height = height;
      onChange();
    },
  });

  wrap.appendChild(toolbar);
  wrap.appendChild(contentWrap);

  applyFontClass(textarea, block.font);
  applyFontClass(preview, block.font);
  applyManualHeight();

  if (autoFocus) {
    showEditor();
  } else {
    showPreview();
  }
  requestAnimationFrame(autoGrow);

  return wrap;
}
