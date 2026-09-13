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
export function createRichTextEditor(
  block,
  onChange,
  { tooltips = {}, tooltipCandidates = [], onCreateTooltip, onUpdateTooltip } = {}
) {
  const editor = document.createElement("div");
  editor.className = "rte-editor";
  editor.contentEditable = "true";
  editor.spellcheck = true;

  migrateLegacyMath(block);
  editor.innerHTML = block.content ? renderEditableHtml(block.content, tooltips) : "";

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

  // Every tooltip created here — whether typed fresh or picked from the
  // "link to existing" list — becomes a reference into the sheet's shared
  // tooltip library (state.js's getTooltips/setTooltip, threaded in as
  // `tooltips` + onCreateTooltip/onUpdateTooltip) rather than owning
  // private text. That's deliberate, not just for triggers the user
  // explicitly wants shared: it's what makes ANY tooltip available to link
  // to later from somewhere else — one created as an apparent one-off is
  // exactly as linkable afterward as one created via "link to existing."
  function insertTooltip() {
    const sel = window.getSelection();
    if (sel.isCollapsed) {
      alert("Select some text first to attach a tooltip to it.");
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const savedRange = range.cloneRange();
    const selectedText = savedRange.toString();
    openTooltipPopup(
      { triggerText: selectedText, tooltipText: "", isLinked: false, tooltipCandidates },
      {
        onConfirm: ({ triggerText, mode, tooltipText, tooltipId }) => {
          const id = mode === "link" ? tooltipId : onCreateTooltip(tooltipText);
          const span = buildTooltipSpan(triggerText, id, tooltips);
          savedRange.deleteContents();
          savedRange.insertNode(span);
          handleInput();
          focusEditor();
        },
      }
    );
  }

  // Double-clicking an existing tooltip reopens it in the tooltip popup,
  // pre-filled with its trigger text and current tooltip content — the
  // trigger itself is contenteditable=false (a single atomic unit, not
  // inline-editable character-by-character), so this is the only way to
  // change one after it's created. A tooltip from a sheet saved before
  // linking existed (data-tooltip, private text, no data-tooltip-id) gets
  // promoted into the shared library the moment it's edited here — the
  // same one-time-upgrade-on-touch pattern migrateLegacyMath uses for
  // AsciiMath, just per-tooltip instead of per-block since each one is
  // individually addressable. Double-clicking an equation reopens it in
  // the math popup the same way.
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
    const isLinked = !!trigger.dataset.tooltipId;
    const currentTooltipText = isLinked
      ? tooltips[trigger.dataset.tooltipId] || ""
      : trigger.dataset.tooltip || "";
    openTooltipPopup(
      {
        triggerText: trigger.textContent,
        tooltipText: currentTooltipText,
        isLinked,
        tooltipCandidates,
      },
      {
        onConfirm: ({ triggerText, mode, tooltipText, tooltipId }) => {
          trigger.textContent = triggerText;
          let finalId;
          if (mode === "link") {
            finalId = tooltipId;
          } else if (isLinked) {
            onUpdateTooltip(trigger.dataset.tooltipId, tooltipText);
            finalId = trigger.dataset.tooltipId;
          } else {
            finalId = onCreateTooltip(tooltipText);
          }
          trigger.dataset.tooltipId = finalId;
          delete trigger.dataset.tooltip;
          trigger.title = tooltips[finalId] || tooltipText;
          handleInput();
        },
        onUnlink: isLinked
          ? () => {
              const newId = onCreateTooltip(currentTooltipText);
              trigger.dataset.tooltipId = newId;
              trigger.title = currentTooltipText;
              handleInput();
            }
          : null,
      }
    );
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

function buildTooltipSpan(triggerText, tooltipId, tooltips) {
  const span = document.createElement("span");
  span.className = "text-tooltip-trigger";
  span.tabIndex = 0;
  span.contentEditable = "false";
  span.dataset.tooltipId = tooltipId;
  span.title = (tooltips && tooltips[tooltipId]) || "";
  span.textContent = triggerText;
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

// A popup for creating/editing a tooltip's trigger text and content —
// replaces two sequential prompt() calls, whose single-line inputs
// visually truncate anything longer than the dialog's width with no way
// to see the rest without it (the underlying value was always complete;
// the native dialog just couldn't display it). A real textarea here shows
// and wraps the full text properly.
//
// When existing tooltips are available (tooltips is non-empty), a mode
// toggle lets the user either type new text or pick one of those to link
// to instead — see the comment on insertTooltip() above for why every
// tooltip, not just ones explicitly marked shared, ends up linkable.
// isLinked (true when editing an already-linked trigger) adds an Unlink
// button that detaches just this one instance into its own independent
// (but still library-backed) entry, leaving the shared one and every
// other trigger still pointing at it untouched.
//
// callbacks.onConfirm({ triggerText, mode: "text", tooltipText } |
// { triggerText, mode: "link", tooltipId }) fires on a valid confirm;
// callbacks.onUnlink() fires only from the Unlink button. Cancel/Escape/
// clicking the backdrop just close it with no callback either way.
//
// tooltipCandidates (blocks.js's collectTooltipCandidates) covers both
// already-shared ({{id}}) and legacy, still-private ({text}) tooltips
// found anywhere in the sheet. Picking a legacy one reports back as an
// ordinary mode: "text" confirm — reusing exactly the "create a shared
// entry seeded with this text" path a freshly-typed tooltip already goes
// through, since that's all promoting one really is.
//
// The dropdown shows each candidate's TRIGGER text, not its tooltip
// content — that's what the user actually recognizes from reading their
// own document, where a tooltip's wording can be long or generic. Only
// when the same trigger text maps to more than one distinct tooltip
// (genuinely different notes that happen to share wording) does the
// tooltip text get appended to those specific entries, to tell them apart.
function openTooltipPopup(
  { triggerText = "", tooltipText = "", isLinked = false, tooltipCandidates = [] },
  callbacks
) {
  const { onConfirm, onUnlink } = callbacks;
  const triggerCounts = new Map();
  tooltipCandidates.forEach((c) => {
    triggerCounts.set(c.triggerText, (triggerCounts.get(c.triggerText) || 0) + 1);
  });
  const candidates = tooltipCandidates.map((c) => {
    const ambiguous = triggerCounts.get(c.triggerText) > 1;
    const preview = c.tooltipText.length > 50 ? `${c.tooltipText.slice(0, 50)}…` : c.tooltipText;
    return { ...c, label: ambiguous ? `${c.triggerText} — ${preview}` : c.triggerText };
  });

  const overlay = document.createElement("div");
  overlay.className = "rte-math-popup-overlay";

  const box = document.createElement("div");
  box.className = "rte-math-popup";
  overlay.appendChild(box);

  const triggerLabel = document.createElement("div");
  triggerLabel.className = "rte-math-popup-label";
  triggerLabel.textContent = "Trigger text:";
  box.appendChild(triggerLabel);

  const triggerInput = document.createElement("input");
  triggerInput.type = "text";
  triggerInput.className = "rte-tooltip-popup-input";
  triggerInput.value = triggerText;
  box.appendChild(triggerInput);

  let mode = "text";

  if (candidates.length > 0) {
    const modeRow = document.createElement("div");
    modeRow.className = "rte-tooltip-popup-mode-row";

    const textLabel = document.createElement("label");
    const textRadio = document.createElement("input");
    textRadio.type = "radio";
    textRadio.name = "rte-tooltip-mode";
    textRadio.checked = true;
    textLabel.appendChild(textRadio);
    textLabel.append(" Type tooltip text");

    const linkLabel = document.createElement("label");
    const linkRadio = document.createElement("input");
    linkRadio.type = "radio";
    linkRadio.name = "rte-tooltip-mode";
    linkLabel.appendChild(linkRadio);
    linkLabel.append(" Link to existing tooltip");

    modeRow.appendChild(textLabel);
    modeRow.appendChild(linkLabel);
    box.appendChild(modeRow);

    textRadio.addEventListener("change", () => setMode("text"));
    linkRadio.addEventListener("change", () => setMode("link"));
  }

  const tooltipLabel = document.createElement("div");
  tooltipLabel.className = "rte-math-popup-label rte-tooltip-popup-second-label";
  tooltipLabel.textContent = "Tooltip text (can include a URL):";
  box.appendChild(tooltipLabel);

  const tooltipInput = document.createElement("textarea");
  tooltipInput.className = "rte-tooltip-popup-textarea";
  tooltipInput.rows = 4;
  tooltipInput.value = tooltipText;
  box.appendChild(tooltipInput);

  const linkSelect = document.createElement("select");
  linkSelect.className = "rte-tooltip-popup-select";
  linkSelect.hidden = true;
  candidates.forEach((candidate, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = candidate.kind === "legacy" ? `${candidate.label} (not yet shared)` : candidate.label;
    linkSelect.appendChild(opt);
  });
  box.appendChild(linkSelect);

  function setMode(next) {
    mode = next;
    tooltipLabel.hidden = mode === "link";
    tooltipInput.hidden = mode === "link";
    linkSelect.hidden = mode === "text";
  }

  const buttonRow = document.createElement("div");
  buttonRow.className = "rte-math-popup-buttons";

  if (isLinked && onUnlink) {
    const unlinkBtn = document.createElement("button");
    unlinkBtn.type = "button";
    unlinkBtn.className = "rte-tooltip-popup-unlink";
    unlinkBtn.textContent = "Unlink";
    unlinkBtn.title = "Make this one instance independent — won't update when the shared tooltip changes anymore";
    unlinkBtn.addEventListener("click", () => {
      close();
      onUnlink();
    });
    buttonRow.appendChild(unlinkBtn);
  }

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "primary";
  confirmBtn.textContent = tooltipText || isLinked ? "Update" : "Insert";
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
    const finalTrigger = triggerInput.value.trim();
    if (!finalTrigger) return;
    if (mode === "link") {
      const candidate = candidates[Number(linkSelect.value)];
      if (!candidate) return;
      close();
      if (candidate.kind === "id") {
        onConfirm({ triggerText: finalTrigger, mode: "link", tooltipId: candidate.id });
      } else {
        // A legacy (not-yet-shared) text — promote it via the same path a
        // freshly-typed tooltip uses, seeded with its existing text.
        onConfirm({ triggerText: finalTrigger, mode: "text", tooltipText: candidate.tooltipText });
      }
    } else {
      const text = tooltipInput.value.trim();
      if (!text) return;
      close();
      onConfirm({ triggerText: finalTrigger, mode: "text", tooltipText: text });
    }
  });
  // Escape cancels from any field; Enter in the (single-line) trigger
  // field just moves to the tooltip textarea rather than submitting, since
  // Enter inside the textarea itself needs to insert a real newline.
  triggerInput.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") {
      close();
    } else if (evt.key === "Enter") {
      evt.preventDefault();
      tooltipInput.focus();
    }
  });
  tooltipInput.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") close();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => triggerInput.focus());
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
    const triggerText = escapeMarkupChars(child.textContent);
    if (child.dataset.tooltipId) {
      return `[${triggerText}]{{${child.dataset.tooltipId}}}`;
    }
    const tooltip = child.dataset.tooltip || "";
    return `[${triggerText}]{${tooltip}}`;
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
