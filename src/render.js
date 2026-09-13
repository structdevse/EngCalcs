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

// tooltipIndex is threaded through every applyInlineFormatting call within
// one renderMathText invocation (there's one call per non-math segment), so
// each rendered tooltip trigger gets a stable, source-order index baked in
// as data-tooltip-index. findTooltipRanges() below scans the raw source
// for the same [trigger]{tooltip} pattern in the same left-to-right order —
// math spans are skipped entirely by both passes, so the indices line up —
// which is how a double-click on a rendered trigger maps back to the exact
// substring in block.content to edit.
export function renderMathText(source) {
  if (!window.katex) return applyInlineFormatting(escapeForHtml(source), { n: 0 });

  const pattern = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
  const tooltipIndex = { n: 0 };
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    result += applyInlineFormatting(escapeForHtml(source.slice(lastIndex, match.index)), tooltipIndex);
    const display = match[1] !== undefined;
    const asciiMath = display ? match[1] : match[2];
    try {
      result += window.katex.renderToString(asciiMathToLatex(asciiMath), {
        throwOnError: false,
        displayMode: display,
      });
    } catch (e) {
      result += escapeForHtml(match[0]);
    }
    lastIndex = pattern.lastIndex;
  }
  result += applyInlineFormatting(escapeForHtml(source.slice(lastIndex)), tooltipIndex);
  return result;
}

// Finds every [trigger]{tooltip} occurrence directly in the raw, unrendered
// source, in reading order, with each match's exact character range. Used
// to locate the source text behind a rendered tooltip trigger (identified
// by its data-tooltip-index) so it can be edited in place. Deliberately
// requires a literal "{" right after "]" so [text](url) links never match.
export function findTooltipRanges(source) {
  const ranges = [];
  const pattern = /\[([^\]]+)\]\{([^}]+)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    ranges.push({ start: match.index, end: pattern.lastIndex, trigger: match[1], tooltip: match[2] });
  }
  return ranges;
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
function applyInlineFormatting(escapedText, tooltipIndex) {
  let html = escapedText;
  html = html.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/gs, "<u>$1</u>");
  html = html.replace(/\*(.+?)\*/gs, "<em>$1</em>");
  html = html.replace(/\{(red|purple|green|gray|blue)\}(.+?)\{\/color\}/gs, (_m, color, inner) => {
    return `<span class="text-fmt-${color}">${inner}</span>`;
  });

  // [text](url) links and [text]{tooltip} tooltips share the same [text]
  // prefix, so one pass handles both, branching on the delimiter that
  // follows. Both are extracted to placeholder tokens first so the bare-URL
  // auto-link pass below can't find and re-wrap a URL already inside one of
  // these (which would produce a broken, nested <a><a>...</a></a>) — and so
  // a link nested inside a tooltip isn't independently re-matched as its
  // own top-level link.
  const specials = [];
  html = html.replace(
    /\[([^\]]+)\](?:\((https?:\/\/[^\s)]+)\)|\{([^}]+)\})/g,
    (_m, text, url, tooltip) => {
      const token = `SPECIAL${specials.length}`;
      specials.push(url !== undefined ? linkTag(url, text) : tooltipTag(text, tooltip, tooltipIndex));
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

// The tooltip's own content is re-run through the full formatting pipeline
// (recursively) — that's what lets a link typed inside a tooltip actually
// become clickable, rather than sitting there as inert text. Bold/italic/
// underline/color inside a tooltip already work with no extra handling:
// those passes already ran on the whole string before this one, since they
// don't know or care about [] / {} boundaries.
function tooltipTag(triggerText, tooltipRawContent, tooltipIndex) {
  const index = tooltipIndex.n++;
  const tooltipHtml = applyInlineFormatting(tooltipRawContent, tooltipIndex);
  return (
    `<span class="text-tooltip-trigger" tabindex="0" data-tooltip-index="${index}">${triggerText}` +
    `<span class="text-tooltip-popup">${tooltipHtml}</span></span>`
  );
}
