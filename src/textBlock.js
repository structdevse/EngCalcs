import { renderMathText, TEXT_COLOR_NAMES } from "./render.js";
import { attachResizeHandle } from "./resizeHandle.js";
import { wireTooltipPopups } from "./tooltipPopup.js";
import { createRichTextEditor } from "./richTextEditor.js";

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

// Builds a text block. The editable path is a single contenteditable
// surface (src/richTextEditor.js) that IS the rendered view — there's no
// separate raw-markup mode and no focus-based toggle between "editing" and
// "viewing" the way an earlier textarea+preview version had; typing,
// formatting, and viewing all happen on the same live surface, and the
// toolbar stays visible the whole time rather than appearing/disappearing
// on focus (that toggle was the source of several hard-won bug fixes
// previously — not needed at all now that there's only one surface).
// Pass autoFocus for a freshly-added block so it opens ready to type. Pass
// readOnly (formal view / shared-link viewer) to render only the static
// preview — no contenteditable at all.
export function createTextBlock(
  block,
  onChange,
  { autoFocus = false, readOnly = false, tooltips = {}, onCreateTooltip, onUpdateTooltip } = {}
) {
  const wrap = document.createElement("div");
  wrap.className = "text-block";

  if (readOnly) {
    const preview = document.createElement("div");
    preview.className = "text-block-preview formal";
    applyFontClass(preview, block.font);
    preview.innerHTML = block.content ? renderMathText(block.content, block.mathFormat, tooltips) : "";
    wireTooltipPopups(preview);
    wrap.appendChild(preview);
    return wrap;
  }

  const rte = createRichTextEditor(
    block,
    (content) => {
      if (content !== undefined) block.content = content;
      autoGrow();
      onChange(block.content);
    },
    { tooltips, onCreateTooltip, onUpdateTooltip }
  );
  const editorEl = rte.element;
  editorEl.classList.add("text-block-input", "rte-live");

  const toolbar = document.createElement("div");
  toolbar.className = "text-format-toolbar";

  function addFormatBtn(label, className, title, action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `text-format-btn ${className}`;
    btn.textContent = label;
    if (title) btn.title = title;
    // Keeps the current selection inside the editor alive across the
    // click — without this, clicking the button blurs the contenteditable
    // first and the selection it depends on can collapse before the
    // click handler runs.
    btn.addEventListener("mousedown", (evt) => evt.preventDefault());
    btn.addEventListener("click", action);
    toolbar.appendChild(btn);
  }

  addFormatBtn("B", "bold", null, () => rte.bold());
  addFormatBtn("I", "italic", null, () => rte.italic());
  addFormatBtn("U", "underline", null, () => rte.underline());

  const colorSelect = document.createElement("select");
  colorSelect.className = "text-format-color";
  colorSelect.addEventListener("mousedown", (evt) => evt.stopPropagation());
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
    if (color) rte.applyColor(color);
  });
  toolbar.appendChild(colorSelect);

  addFormatBtn(
    "Link",
    "link",
    "Turn the selection into a link (or paste/type a bare URL — those link automatically)",
    () => rte.insertLink()
  );
  addFormatBtn(
    "Tip",
    "tooltip-btn",
    "Attach a hover tooltip to the selection (can include a link)",
    () => rte.insertTooltip()
  );
  addFormatBtn("Σ Math", "math-btn", "Insert an equation", () => rte.insertMath());

  const fontSelect = document.createElement("select");
  fontSelect.className = "text-format-font";
  fontSelect.addEventListener("mousedown", (evt) => evt.stopPropagation());
  FONT_OPTIONS.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    fontSelect.appendChild(opt);
  });
  fontSelect.value = block.font || "";
  fontSelect.addEventListener("change", () => {
    block.font = fontSelect.value || undefined;
    applyFontClass(editorEl, block.font);
    rte.focus();
    onChange();
  });
  toolbar.appendChild(fontSelect);

  function applyManualHeight() {
    editorEl.style.height = block.height ? `${block.height}px` : "";
  }

  // A contenteditable div grows with its own content naturally (unlike a
  // textarea, which needs manual scrollHeight-based resizing) — this only
  // needs to re-clear any leftover fixed height from a resize the user
  // might undo by editing past it, and only when there's no manual height
  // in effect.
  function autoGrow() {
    if (block.height) return;
    editorEl.style.height = "";
  }

  const contentWrap = document.createElement("div");
  contentWrap.className = "text-block-content";
  contentWrap.appendChild(editorEl);

  attachResizeHandle(contentWrap, {
    axis: "vertical",
    minHeightFloor: 48,
    onResize: (_width, height) => {
      editorEl.style.height = `${height}px`;
    },
    onResizeEnd: (_width, height) => {
      block.height = height;
      onChange();
    },
  });

  wrap.appendChild(toolbar);
  wrap.appendChild(contentWrap);

  applyFontClass(editorEl, block.font);
  applyManualHeight();

  if (autoFocus) rte.focus();

  return wrap;
}
