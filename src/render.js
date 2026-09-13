// Renders a block of text containing $inline$ and $$display$$ math into
// HTML, leaving surrounding plain text intact. The math itself is written
// in AsciiMath (e.g. "x^2/y", "sqrt(x+1)") rather than raw LaTeX — friendlier
// to type and read without memorizing LaTeX commands. It's converted to
// LaTeX under the hood so KaTeX can render it.
//
// Plain text also supports lightweight inline formatting: **bold**,
// *italic*, __underline__, and {colorname}text{/color}. This never runs
// inside math spans — a $...$ span is handed to AsciiMath as opaque source,
// so formatting delimiters there can't collide with math syntax.

const asciiMathParser = window.AsciiMathParser ? new window.AsciiMathParser() : null;

export const TEXT_COLOR_NAMES = ["red", "purple", "green", "gray", "blue"];

function asciiMathToLatex(source) {
  if (!asciiMathParser) return source;
  try {
    return asciiMathParser.parse(source);
  } catch (e) {
    return source;
  }
}

// Backslash-escaping for the handful of characters that are otherwise
// markup syntax (\* \_ \{ \} \[ \] \$ \\) — needed once prose can contain
// them literally on purpose (e.g. "F = 2 * 3" in an engineering calc). Runs
// as a strip/restore pass wrapped around the whole existing pipeline below,
// rather than teaching every individual regex to skip escaped delimiters:
// each \X is swapped for a Private-Use-Area placeholder character before
// any parsing happens (so it can't match $ .. $, ** .. **, etc. at all),
// then swapped back to the literal character in the final HTML output.
const ESCAPE_PLACEHOLDER_BASE = 0xe000;

function stripEscapes(source) {
  const literals = [];
  const escaped = String(source).replace(/\\([\\$*_{}[\]])/g, (_m, ch) => {
    const token = String.fromCodePoint(ESCAPE_PLACEHOLDER_BASE + literals.length);
    literals.push(ch);
    return token;
  });
  return { escaped, literals };
}

function restoreEscapes(html, literals) {
  if (literals.length === 0) return html;
  return html.replace(/[-]/g, (ch) => {
    const index = ch.codePointAt(0) - ESCAPE_PLACEHOLDER_BASE;
    return literals[index] !== undefined ? literals[index] : ch;
  });
}

// tooltipIndex is threaded through every applyInlineFormatting call within
// one renderMathText invocation (there's one call per non-math segment), so
// each rendered tooltip trigger gets a stable, source-order index baked in
// as data-tooltip-index. findTooltipRanges() below scans the raw source
// for the same [trigger]{tooltip} pattern in the same left-to-right order —
// math spans are skipped entirely by both passes, so the indices line up —
// which is how a double-click on a rendered trigger maps back to the exact
// substring in block.content to edit.
//
// mathFormat is per-block, not per-span: "asciimath" (the default, and
// every block ever saved before the WYSIWYG rich-text editor existed) runs
// math source through asciiMathToLatex first; "latex" (written by the
// MathLive-based editor, which speaks LaTeX natively) hands it to KaTeX
// as-is. A block's format only ever changes by being re-saved through the
// new editor, so old, untouched sheets keep rendering exactly as before.
export function renderMathText(source, mathFormat = "asciimath", tooltips = {}) {
  const { escaped, literals } = stripEscapes(source);
  return restoreEscapes(renderMathTextInner(escaped, mathFormat, { n: 0, editable: false, tooltips }), literals);
}

// The WYSIWYG rich-text editor's counterpart to renderMathText: same markup
// parsing (same escape handling, same bold/italic/color/link passes), but
// produces DOM the editor can mount directly instead of a static display —
// math spans become live <math-field> elements instead of a KaTeX render,
// and a tooltip trigger carries its content as a data-tooltip attribute
// instead of a nested hover-reveal popup (there's nothing to "hover" while
// editing; the popup markup is only meaningful for the read-only display).
// Always treats mathSource as LaTeX regardless of the block's stored
// mathFormat — the caller (richTextEditor.js) is responsible for
// converting legacy AsciiMath to LaTeX once, at load time, via
// asciiMathToLatexPublic below, since from this point on editing always
// produces LaTeX.
export function renderEditableHtml(source, tooltips = {}) {
  const { escaped, literals } = stripEscapes(source);
  return restoreEscapes(renderMathTextInner(escaped, "latex", { n: 0, editable: true, tooltips }), literals);
}

// Exposed so richTextEditor.js can do the one-time AsciiMath→LaTeX
// conversion when a legacy block is first opened in the new editor.
export function asciiMathToLatexPublic(source) {
  return asciiMathToLatex(source);
}

function renderMathTextInner(source, mathFormat, ctx) {
  if (!window.katex) return applyInlineFormatting(escapeForHtml(source), ctx);

  const pattern = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    result += applyInlineFormatting(escapeForHtml(source.slice(lastIndex, match.index)), ctx);
    const display = match[1] !== undefined;
    const mathSource = display ? match[1] : match[2];
    // editable mode always treats mathSource as LaTeX (see the comment on
    // renderEditableHtml below); read-only mode still respects the block's
    // own stored mathFormat.
    const latex = ctx.editable || mathFormat === "latex" ? mathSource : asciiMathToLatex(mathSource);
    try {
      const rendered = window.katex.renderToString(latex, { throwOnError: false, displayMode: display });
      result += ctx.editable ? editableMathTag(rendered, latex, display) : rendered;
    } catch (e) {
      result += escapeForHtml(match[0]);
    }
    lastIndex = pattern.lastIndex;
  }
  result += applyInlineFormatting(escapeForHtml(source.slice(lastIndex)), ctx);
  return result;
}

// A math span in the editor renders live (via KaTeX, same as the read-only
// view) rather than as an editable MathLive <math-field> the way an
// earlier version of this did — MathLive's keyboard capture turns out not
// to work at all when nested inside a native contenteditable ancestor
// (confirmed: a standalone field works, this exact field embedded here
// does not — a documented MathLive/contenteditable incompatibility, not a
// bug fixable with a quick patch). Clicking it instead opens an isolated
// math-field in a popup (richTextEditor.js's openMathPopup, mounted
// outside the contenteditable tree, where MathLive works correctly) to
// edit the LaTeX, then re-renders this same static display on confirm.
function editableMathTag(renderedHtml, latex, display) {
  const safeLatex = latex.replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
  return (
    `<span class="rte-math" data-latex="${safeLatex}" data-display="${display ? "block" : "inline"}" ` +
    `contenteditable="false" tabindex="0">${renderedHtml}</span>`
  );
}

function escapeForHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// Runs against already-HTML-escaped text, so the only "<" / ">" present are
// the tags this function inserts itself — safe against injection regardless
// of what a user types, since color names are matched against a fixed list
// rather than interpolated freely. The `s` flag lets a formatted span cross
// what were originally line breaks (now literal <br> in the escaped text).
function applyInlineFormatting(escapedText, ctx) {
  let html = escapedText;
  html = html.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/gs, "<u>$1</u>");
  html = html.replace(/\*(.+?)\*/gs, "<em>$1</em>");
  html = html.replace(/\{(red|purple|green|gray|blue)\}(.+?)\{\/color\}/gs, (_m, color, inner) => {
    return `<span class="text-fmt-${color}">${inner}</span>`;
  });

  // [text](url) links, [text]{tooltip} one-off tooltips, and
  // [text]{{id}} linked tooltips (a reference into the sheet's shared
  // tooltip library — see state.js's getTooltips/setTooltip) all share the
  // same [text] prefix, so one pass handles all three, branching on the
  // delimiter that follows. The double-brace alternative is tried before
  // the single-brace one so {{id}} isn't instead matched as literal text
  // "{id}" wrapped in an extra pair of braces. All three are extracted to
  // placeholder tokens first so the bare-URL auto-link pass below can't
  // find and re-wrap a URL already inside one of these (which would
  // produce a broken, nested <a><a>...</a></a>) — and so a link nested
  // inside a tooltip isn't independently re-matched as its own top-level
  // link.
  const specials = [];
  html = html.replace(
    /\[([^\]]+)\](?:\((https?:\/\/[^\s)]+)\)|\{\{([^}]+)\}\}|\{([^}]+)\})/g,
    (_m, text, url, linkedId, tooltip) => {
      const token = `SPECIAL${specials.length}`;
      if (url !== undefined) {
        specials.push(linkTag(url, text));
      } else if (linkedId !== undefined) {
        specials.push(tooltipTag(text, linkedId, ctx, true));
      } else {
        specials.push(tooltipTag(text, tooltip, ctx, false));
      }
      return token;
    }
  );

  // Bare URLs auto-linkify with no syntax needed. Trailing punctuation likely
  // belongs to the sentence, not the URL (e.g. "see https://example.com."),
  // so it's split off and placed outside the link.
  html = html.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const trailing = (url.match(/[.,;:!?)]+$/) || [""])[0];
    const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
    return cleanUrl ? linkTag(cleanUrl, cleanUrl) + trailing : url;
  });

  specials.forEach((specialHtml, i) => {
    html = html.replace(`SPECIAL${i}`, specialHtml);
  });

  return html;
}

function linkTag(url, text) {
  const safeUrl = url.replace(/"/g, "&quot;");
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

// The tooltip's own content is re-run through the full formatting pipeline
// (recursively) — that's what lets a link typed inside a tooltip actually
// become clickable, rather than sitting there as inert text. Bold/italic/
// underline/color inside a tooltip already work with no extra handling:
// those passes already ran on the whole string before this one, since they
// don't know or care about [] / {} boundaries.
//
// In editable mode, the tooltip's content is stashed in a data attribute
// (HTML-attribute-escaped, so quotes/newlines can't break out of it)
// rather than rendered into a nested popup — there's no hover in an
// editor, and richTextEditor.js's serializer reads the attribute straight
// back out rather than walking rendered HTML. A one-off tooltip's own text
// lives in data-tooltip; a linked one instead carries data-tooltip-id
// (its key into the sheet's shared tooltips library) with no private text
// of its own — richTextEditor.js resolves the id to text on demand
// (editing it, or just showing its current text) rather than baking a
// stale copy into the DOM at render time.
//
// `ref` is either the literal tooltip text (isLinked false) or the shared
// library id to look up in ctx.tooltips (isLinked true).
function tooltipTag(triggerText, ref, ctx, isLinked) {
  const resolvedText = isLinked ? (ctx.tooltips && ctx.tooltips[ref]) || "" : ref;

  if (ctx.editable) {
    if (isLinked) {
      const safeResolved = escapeAttr(resolvedText);
      return (
        `<span class="text-tooltip-trigger" tabindex="0" data-tooltip-id="${ref}" ` +
        `title="${safeResolved}" contenteditable="false">${triggerText}</span>`
      );
    }
    const safeTooltip = escapeAttr(ref);
    return (
      `<span class="text-tooltip-trigger" tabindex="0" data-tooltip="${safeTooltip}" ` +
      `title="${safeTooltip}" contenteditable="false">${triggerText}</span>`
    );
  }

  const index = ctx.n++;
  // ref is already HTML-escaped in the literal case (it's a substring of
  // text applyInlineFormatting received pre-escaped) — the linked case's
  // resolvedText comes straight from the tooltip library instead, raw, so
  // it needs that same escaping applied here before formatting runs on it.
  const tooltipSource = isLinked ? escapeForHtml(resolvedText) : ref;
  const tooltipHtml = applyInlineFormatting(tooltipSource, ctx);
  return (
    `<span class="text-tooltip-trigger" tabindex="0" data-tooltip-index="${index}">${triggerText}` +
    `<span class="text-tooltip-popup">${tooltipHtml}</span></span>`
  );
}
