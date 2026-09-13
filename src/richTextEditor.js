import { renderEditableHtml, asciiMathToLatexPublic, TEXT_COLOR_NAMES } from "./render.js";

// A true WYSIWYG editor for text blocks: a single contenteditable surface
// that IS the rendered view (bold looks bold as you type, a tooltip looks
// like a tooltip, an equation is a live MathLive <math-field> widget) —
// there's no separate raw-markup textarea and no toggle between "editing"
// and "viewing" the way the old textarea+preview implementation had. That
// split existed because a plain textarea can't render anything; a
// contenteditable can, so editing and viewing collapse into one surface.
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
  // Deferred: a math-field needs to actually be connected to the document
  // before its menuItems can be set (throws "Mathfield not mounted"
  // otherwise), and `editor` itself isn't connected yet at this point —
  // createRichTextEditor() only builds the element here, the caller
  // (textBlock.js) appends it to the page afterward. One frame is enough
  // for that append to have already happened.
  requestAnimationFrame(() => disableMathFieldMenus(editor));

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
  // so this is the only way to change one after it's created.
  editor.addEventListener("dblclick", (evt) => {
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
    focusEditor();
    const field = document.createElement("math-field");
    field.setAttribute("contenteditable", "false");
    field.dataset.display = "inline";
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(field);
    } else {
      editor.appendChild(field);
    }
    handleInput();
    // math-field manages its own internal focus/cursor — hand off to it
    // once it's actually mounted and upgraded, not synchronously. Setting
    // menuItems requires the element to already be connected to the DOM
    // too, hence both happen in here rather than right after creation.
    requestAnimationFrame(() => {
      disableMathFieldMenu(field);
      field.focus();
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

// MathLive's built-in menu button visually fills almost the entire field
// while it's empty (or even once it has content, in the corner) — its
// click target ends up covering the whole field, which both pops a Copy/
// Select-All context menu on click AND swallows the click that would
// otherwise place a text cursor there for typing. Disabling it fixes both:
// a plain click focuses the field normally, the way typing into any other
// field is expected to work.
function disableMathFieldMenu(field) {
  try {
    field.menuItems = [];
  } catch (e) {
    // Not yet connected/upgraded — disableMathFieldMenus (plural, below)
    // covers the load-time case where multiple fields exist at once.
  }
}

function disableMathFieldMenus(root) {
  root.querySelectorAll("math-field").forEach(disableMathFieldMenu);
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
  if (tag === "MATH-FIELD") {
    const latex = child.value || "";
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
