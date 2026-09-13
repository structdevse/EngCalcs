import { renderEditableHtml, asciiMathToLatexPublic, TEXT_COLOR_NAMES } from "./render.js";

// A true WYSIWYG editor for text blocks: a single contenteditable surface
// that IS the rendered view (bold looks bold as you type, a tooltip looks
// like a tooltip, an equation renders live via KaTeX) — there's no
// separate raw-markup textarea and no toggle between "editing" and
// "viewing" the way the old textarea+preview implementation had. That
// split existed because a plain textarea can't render anything; a
// contenteditable can, so editing and viewing collapse into one surface.
//
// Math is the one exception to "directly editable in place": clicking an
// equation opens it in a small popup (openMathPopup below) containing an
// isolated MathLive <math-field>, rather than embedding the math-field
// directly inline. That's not a stylistic choice — MathLive's keyboard
// capture turns out not to work at all when the field is nested inside a
// native contenteditable ancestor (confirmed directly: an identical field
// standalone accepts typing fine, embedded here it doesn't — a documented
// MathLive/contenteditable incompatibility). The popup's field lives
// outside the contenteditable tree entirely, where it works correctly.
//
// block.content still stores the exact same markup string format as
// before (**bold**, {color}...{/color}, [text](url), [text]{tooltip},
// $math$) — this module's whole job is translating between that string and
// a live DOM: renderEditableHtml() (render.js) builds the DOM from the
// string on load, and serialize() below walks the DOM back into the string
// on every edit. Nothing about the stored format, Drive files, print view,
// or read-only rendering changes — see render.js's mathFormat comment for
// how existing AsciiMath sheets keep working untouched.
export function createRichTextEditor(block, onChange) {
  const editor = document.createElement("div");
  editor.className = "rte-editor";
  editor.contentEditable = "true";
  editor.spellcheck = true;

  migrateLegacyMath(block);
  editor.innerHTML = block.content ? renderEditableHtml(block.content) : "";

  // Enter creates a plain <br> line break rather than a browser-default
  // wrapper (a fresh <div> per line in Chrome) — much simpler to round-trip
  // through serialize() below. Only meaningful while this editor has
  // focus, so it's set on focus rather than once globally.
  editor.addEventListener("focus", () => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "br");
    } catch (e) {
      // Some browsers don't support this command at all — falls back to
      // whatever the browser's own default is; serialize()'s DIV/P
      // fallback case still handles that shape reasonably.
    }
  });

  function handleInput() {
    block.content = serializeNode(editor);
    onChange(block.content);
  }
  editor.addEventListener("input", handleInput);

  function focusEditor() {
    editor.focus();
  }

  // Wraps the current selection (if any, and if it's inside this editor)
  // in a new element built by `build()`. Used for anything execCommand
  // doesn't have a matching command for (color, links, tooltips) — bold/
  // italic/underline use execCommand instead (see exec() below), since
  // toggling an existing wrap on/off correctly for arbitrary/partial/
  // nested selections is exactly what it's designed to get right, and a
  // hand-rolled version of that is a well-known source of edge-case bugs.
  function wrapSelection(build) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    const wrapper = build();
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(newRange);
    handleInput();
    return true;
  }

  function exec(command) {
    focusEditor();
    document.execCommand(command);
    handleInput();
  }

  function applyColor(color) {
    focusEditor();
    wrapSelection(() => {
      const span = document.createElement("span");
      span.className = `text-fmt-${color}`;
      return span;
    });
  }

  function insertLink() {
    if (window.getSelection().isCollapsed) {
      alert("Select some text first to turn it into a link.");
      return;
    }
    const url = prompt("Link URL", "https://");
    if (!url) return;
    focusEditor();
    wrapSelection(() => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    });
  }

  function insertTooltip() {
    if (window.getSelection().isCollapsed) {
      alert("Select some text first to attach a tooltip to it.");
      return;
    }
    const tip = prompt('Tooltip text (can include a URL, e.g. "See https://...")', "");
    if (!tip) return;
    focusEditor();
    wrapSelection(() => {
      const span = document.createElement("span");
      span.className = "text-tooltip-trigger";
      span.tabIndex = 0;
      span.contentEditable = "false";
      span.dataset.tooltip = tip;
      span.title = tip;
      return span;
    });
  }

  // Double-clicking an existing tooltip re-prompts for both its trigger
  // text and tooltip content — the trigger itself is contenteditable=false
  // (a single atomic unit, not inline-editable character-by-character),
  // so this is the only way to change one after it's created. Double-
  // clicking an equation reopens it in the math popup, pre-filled.
  editor.addEventListener("dblclick", (evt) => {
    const mathSpan = evt.target.closest(".rte-math");
    if (mathSpan) {
      evt.preventDefault();
      openMathPopup(mathSpan.dataset.latex || "", (latex) => {
        mathSpan.dataset.latex = latex;
        renderMathSpanContent(mathSpan);
        handleInput();
      });
      return;
    }
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (!trigger) return;
    evt.preventDefault();
    const newTriggerText = prompt("Trigger text", trigger.textContent);
    if (newTriggerText === null) return;
    const newTooltip = prompt("Tooltip text", trigger.dataset.tooltip || "");
    if (newTooltip === null) return;
    trigger.textContent = newTriggerText || trigger.textContent;
    trigger.dataset.tooltip = newTooltip;
    trigger.title = newTooltip;
    handleInput();
  });

  function insertMath() {
    const sel = window.getSelection();
    const range =
      sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0).cloneRange()
        : null;
    openMathPopup("", (latex) => {
      const span = buildMathSpan(latex, false);
      if (range) {
        range.deleteContents();
        range.insertNode(span);
      } else {
        editor.appendChild(span);
      }
      handleInput();
      focusEditor();
    });
  }

  return {
    element: editor,
    bold: () => exec("bold"),
    italic: () => exec("italic"),
    underline: () => exec("underline"),
    applyColor,
    insertLink,
    insertTooltip,
    insertMath,
    focus: focusEditor,
  };
}

// A block ever only stored AsciiMath before this editor existed
// (block.mathFormat is undefined for all of them). The first time it's
// opened here, every $..$/$$..$$ span is converted to LaTeX once and the
// block is marked mathFormat: "latex" for good — from then on (including
// in the read-only/print renderer) its math is LaTeX, permanently. A
// sheet never reopened in this editor is never touched and keeps
// rendering via the old AsciiMath path exactly as it always has.
function migrateLegacyMath(block) {
  if (block.mathFormat === "latex") return;
  if (block.content) {
    block.content = block.content.replace(
      /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g,
      (_whole, display, inline) => {
        const src = display !== undefined ? display : inline;
        const latex = asciiMathToLatexPublic(src);
        return display !== undefined ? `$$${latex}$$` : `$${latex}$`;
      }
    );
  }
  block.mathFormat = "latex";
}

// Builds a static, non-editable rendered-math span matching what
// render.js's editableMathTag produces as an HTML string — used here when
// constructing one directly as DOM (a fresh insert, rather than parsed
// from block.content on load).
function buildMathSpan(latex, display) {
  const span = document.createElement("span");
  span.className = "rte-math";
  span.contentEditable = "false";
  span.tabIndex = 0;
  span.dataset.latex = latex;
  span.dataset.display = display ? "block" : "inline";
  renderMathSpanContent(span);
  return span;
}

function renderMathSpanContent(span) {
  const latex = span.dataset.latex || "";
  const display = span.dataset.display === "block";
  if (!window.katex) {
    span.textContent = latex;
    return;
  }
  try {
    span.innerHTML = window.katex.renderToString(latex, { throwOnError: false, displayMode: display });
  } catch (e) {
    span.textContent = latex;
  }
}

// A small popup holding one isolated MathLive field — isolated meaning
// appended to document.body, deliberately outside any contenteditable
// ancestor, which is what makes typing into it actually work (see the
// comment at the top of this file). onConfirm(latex) fires only if the
// user confirms with non-empty content; Cancel/Escape/clicking the
// backdrop all just close it with no callback.
function openMathPopup(initialLatex, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "rte-math-popup-overlay";

  const box = document.createElement("div");
  box.className = "rte-math-popup";
  overlay.appendChild(box);

  const label = document.createElement("div");
  label.className = "rte-math-popup-label";
  label.textContent = "Type your equation:";
  box.appendChild(label);

  const field = document.createElement("math-field");
  field.className = "rte-math-popup-field";
  box.appendChild(field);

  const buttonRow = document.createElement("div");
  buttonRow.className = "rte-math-popup-buttons";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "primary";
  confirmBtn.textContent = initialLatex ? "Update" : "Insert";
  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(confirmBtn);
  box.appendChild(buttonRow);

  function close() {
    overlay.remove();
  }

  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (evt) => {
    if (evt.target === overlay) close();
  });
  confirmBtn.addEventListener("click", () => {
    const latex = field.value || "";
    close();
    if (latex) onConfirm(latex);
  });
  field.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      confirmBtn.click();
    } else if (evt.key === "Escape") {
      evt.preventDefault();
      close();
    }
  });

  document.body.appendChild(overlay);
  // Deferred: the field needs to be connected before .menuItems/.value can
  // be set (throws "Mathfield not mounted" otherwise) — see the identical
  // note this replaced further up in this file's history.
  requestAnimationFrame(() => {
    try {
      field.menuItems = [];
      // MathLive's on-screen virtual keyboard defaults to appearing
      // automatically ("auto" policy) — its buttons don't reliably insert
      // into the field in this popup's context, and real typing already
      // works correctly (confirmed), so "manual" just keeps it from ever
      // popping up rather than trying to fix a redundant input path.
      field.mathVirtualKeyboardPolicy = "manual";
    } catch (e) {
      // ignore — cosmetic only, not worth failing the popup over
    }
    if (initialLatex) field.value = initialLatex;
    field.focus();
  });
}

function escapeMarkupChars(text) {
  return text.replace(/[\\$*_{}[\]]/g, (ch) => `\\${ch}`);
}

function serializeNode(node) {
  let out = "";
  node.childNodes.forEach((child) => {
    out += serializeChild(child);
  });
  return out;
}

function serializeChild(child) {
  if (child.nodeType === Node.TEXT_NODE) {
    return escapeMarkupChars(child.textContent);
  }
  if (child.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = child.tagName;
  if (tag === "BR") return "\n";
  if (tag === "STRONG" || tag === "B") return `**${serializeNode(child)}**`;
  if (tag === "EM" || tag === "I") return `*${serializeNode(child)}*`;
  if (tag === "U") return `__${serializeNode(child)}__`;
  if (tag === "A") return `[${serializeNode(child)}](${child.getAttribute("href") || ""})`;
  if (child.classList && child.classList.contains("rte-math")) {
    const latex = child.dataset.latex || "";
    return child.dataset.display === "block" ? `$$${latex}$$` : `$${latex}$`;
  }
  if (child.classList && child.classList.contains("text-tooltip-trigger")) {
    const tooltip = child.dataset.tooltip || "";
    return `[${escapeMarkupChars(child.textContent)}]{${tooltip}}`;
  }
  for (const color of TEXT_COLOR_NAMES) {
    if (child.classList && child.classList.contains(`text-fmt-${color}`)) {
      return `{${color}}${serializeNode(child)}{/color}`;
    }
  }
  if (tag === "DIV" || tag === "P") {
    // Fallback for a browser that ignored defaultParagraphSeparator above
    // and wrapped a line in a block element instead of using <br>.
    return `\n${serializeNode(child)}`;
  }
  // An unrecognized wrapper (e.g. a bare <span> from pasted content) —
  // keep its text rather than losing it, just drop the wrapper itself.
  return serializeNode(child);
}
