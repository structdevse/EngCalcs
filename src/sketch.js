import { attachResizeHandle } from "./resizeHandle.js";

const GRID_SIZE = 28;
const ROUGHNESS = 1.3;
const DEFAULT_CANVAS_WIDTH = 600; // fits within the 624px print-page-width cap
const DEFAULT_CANVAS_HEIGHT = 320;

const PALETTE = [
  { name: "ink", color: "#2b2b2b", darkColor: "#e8e6df" },
  { name: "dimension", color: "#7733aa", darkColor: "#c79bef" },
  { name: "force", color: "#c05050", darkColor: "#e88787" },
  { name: "reaction", color: "#2a6e4a", darkColor: "#6fcf9a" },
  { name: "annotation", color: "#5c6b7a", darkColor: "#a9b8c6" },
];

const TOOLS = ["line", "rect", "circle", "arrow", "dimension", "freehand", "move", "recolor", "erase"];

// Maps a resolved hex color back to its palette index, so sketches saved
// before colorIndex existed (or a color from the "wrong" theme) still
// migrate onto the adaptive lookup below instead of staying stuck.
const paletteIndexByColor = new Map();
PALETTE.forEach((p, i) => {
  paletteIndexByColor.set(p.color, i);
  paletteIndexByColor.set(p.darkColor, i);
});

// Resolves an operation's color against the CURRENT theme, not whichever
// theme was active when it was drawn — otherwise a shape drawn in dark mode
// keeps its light-on-dark color after switching to light mode, and ends up
// low-contrast against the new background.
function colorForOp(op) {
  const isDark = document.documentElement.dataset.theme === "dark";
  let index = op.colorIndex;
  if (index === undefined && op.color !== undefined) {
    index = paletteIndexByColor.get(op.color);
  }
  const entry = PALETTE[index] ?? PALETTE[0];
  return isDark ? entry.darkColor : entry.color;
}
const ERASE_THRESHOLD = 8;
const GRID_DOT_RADIUS = 1.6;

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Returns true if (x, y) is close enough to op's stroke (or inside its
// bounds, for filled-feeling shapes) to count as a click on it.
function hitTestOperation(op, x, y) {
  if (op.tool === "line" || op.tool === "arrow" || op.tool === "dimension") {
    return distToSegment(x, y, op.x1, op.y1, op.x2, op.y2) <= ERASE_THRESHOLD;
  }
  if (op.tool === "rect") {
    const { x: rx, y: ry, w, h } = op;
    if (x >= rx && x <= rx + w && y >= ry && y <= ry + h) return true;
    const edges = [
      [rx, ry, rx + w, ry],
      [rx + w, ry, rx + w, ry + h],
      [rx + w, ry + h, rx, ry + h],
      [rx, ry + h, rx, ry],
    ];
    return edges.some(([x1, y1, x2, y2]) => distToSegment(x, y, x1, y1, x2, y2) <= ERASE_THRESHOLD);
  }
  if (op.tool === "circle") {
    return Math.hypot(x - op.cx, y - op.cy) <= op.r + ERASE_THRESHOLD;
  }
  if (op.tool === "freehand" && op.points) {
    for (let i = 0; i < op.points.length - 1; i++) {
      const [x1, y1] = op.points[i];
      const [x2, y2] = op.points[i + 1];
      if (distToSegment(x, y, x1, y1, x2, y2) <= ERASE_THRESHOLD) return true;
    }
  }
  return false;
}

// Returns a copy of op shifted by (dx, dy).
function translateOp(op, dx, dy) {
  if (op.tool === "line" || op.tool === "arrow" || op.tool === "dimension") {
    return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
  }
  if (op.tool === "rect") {
    return { ...op, x: op.x + dx, y: op.y + dy };
  }
  if (op.tool === "circle") {
    return { ...op, cx: op.cx + dx, cy: op.cy + dy };
  }
  if (op.tool === "freehand") {
    return { ...op, points: op.points.map(([x, y]) => [x + dx, y + dy]) };
  }
  return op;
}

// Builds a sketch block: toolbar + canvas, backed by block.operations.
// onChange(operations) is called after each committed stroke. Pass readOnly
// (formal view) to render the canvas as a static image only — no toolbar,
// and no pointer listeners attached at all, so there's no interaction path
// to guard against even without visible buttons.
export function createSketchBlock(block, onChange, { readOnly = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sketch-block";
  if (readOnly) wrap.classList.add("formal");

  let activeTool = "line";
  let activeColorIndex = 0;
  let snapToGrid = false;
  const toolButtons = {};

  // Undo/redo history (snapshots of block.operations) is declared here,
  // unconditionally, because the pointer-handling code further down needs
  // it too — a function declared inside the `if (!readOnly)` block below
  // would be block-scoped and invisible outside it. The undo/redo BUTTONS
  // are still only created in edit mode; these functions simply never get
  // called when readOnly, since nothing wires up input to call them.
  let undoStack = [];
  let redoStack = [];
  let undoBtn = null;
  let redoBtn = null;

  function cloneOps(ops) {
    return JSON.parse(JSON.stringify(ops));
  }

  function pushUndoSnapshot() {
    undoStack.push(cloneOps(block.operations));
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (!undoBtn) return;
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  if (!readOnly) {
  const toolbar = document.createElement("div");
  toolbar.className = "sketch-toolbar";
  wrap.appendChild(toolbar);

  TOOLS.forEach((tool) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sketch-tool-btn";
    btn.textContent = toolLabel(tool);
    btn.title = tool;
    btn.addEventListener("click", () => setActiveTool(tool));
    toolbar.appendChild(btn);
    toolButtons[tool] = btn;
  });

  function setActiveTool(tool) {
    activeTool = tool;
    Object.entries(toolButtons).forEach(([t, b]) =>
      b.classList.toggle("active", t === tool)
    );
    if (tool === "dimension") {
      // Dimension lines default to the palette's dedicated "dimension"
      // color, matching the plan's drafting-convention color scheme.
      activeColorIndex = 1;
      colorSelect.value = "1";
    }
  }

  const colorSelect = document.createElement("select");
  colorSelect.className = "sketch-color-select";
  PALETTE.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = p.name;
    colorSelect.appendChild(opt);
  });
  colorSelect.addEventListener("change", () => {
    activeColorIndex = Number(colorSelect.value);
  });
  toolbar.appendChild(colorSelect);

  const snapLabel = document.createElement("label");
  snapLabel.className = "sketch-snap-toggle";
  const snapCheckbox = document.createElement("input");
  snapCheckbox.type = "checkbox";
  snapCheckbox.addEventListener("change", () => {
    snapToGrid = snapCheckbox.checked;
    redraw();
  });
  snapLabel.appendChild(snapCheckbox);
  snapLabel.appendChild(document.createTextNode(" snap to grid"));
  toolbar.appendChild(snapLabel);

  undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "sketch-tool-btn";
  undoBtn.textContent = "Undo";
  undoBtn.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    redoStack.push(cloneOps(block.operations));
    block.operations = undoStack.pop();
    updateHistoryButtons();
    redraw();
    onChange(block.operations);
  });
  toolbar.appendChild(undoBtn);

  redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "sketch-tool-btn";
  redoBtn.textContent = "Redo";
  redoBtn.addEventListener("click", () => {
    if (redoStack.length === 0) return;
    undoStack.push(cloneOps(block.operations));
    block.operations = redoStack.pop();
    updateHistoryButtons();
    redraw();
    onChange(block.operations);
  });
  toolbar.appendChild(redoBtn);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "sketch-tool-btn";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => {
    if (block.operations.length === 0) return;
    pushUndoSnapshot();
    block.operations = [];
    redraw();
    onChange(block.operations);
  });
  toolbar.appendChild(clearBtn);

  updateHistoryButtons();
  setActiveTool(activeTool);
  } // end if (!readOnly) toolbar construction

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sketch-canvas-wrap";
  wrap.appendChild(canvasWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "sketch-canvas";
  canvas.width = block.width || DEFAULT_CANVAS_WIDTH;
  canvas.height = block.height || DEFAULT_CANVAS_HEIGHT;
  canvasWrap.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  let rc = window.rough ? window.rough.canvas(canvas) : null;

  if (!readOnly) {
    attachResizeHandle(canvasWrap, {
      minWidth: 200,
      minHeightFloor: 120,
      maxWidth: 624, // matches #blocks-container's print-page-width cap — a
      // sketch wider than that would run off the printed page's edge
      onResize: (width, height) => {
        // Changing width/height attributes clears the canvas bitmap, so
        // the existing drawing has to be repainted immediately after —
        // otherwise it'd visibly vanish for the duration of the drag.
        canvas.width = width;
        canvas.height = height;
        redraw();
      },
      onResizeEnd: (width, height) => {
        block.width = width;
        block.height = height;
        onChange(block.operations);
      },
    });
  }

  function snap(v) {
    return snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : v;
  }

  function pointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: snap((evt.clientX - rect.left) * scaleX),
      y: snap((evt.clientY - rect.top) * scaleY),
    };
  }

  function drawOp(op) {
    if (!rc) return;
    const options = {
      roughness: op.roughness ?? ROUGHNESS,
      stroke: colorForOp(op),
      strokeWidth: op.strokeWidth ?? 2,
    };
    if (op.tool === "line") {
      rc.line(op.x1, op.y1, op.x2, op.y2, options);
    } else if (op.tool === "rect") {
      rc.rectangle(op.x, op.y, op.w, op.h, options);
    } else if (op.tool === "circle") {
      rc.circle(op.cx, op.cy, op.r * 2, options);
    } else if (op.tool === "arrow") {
      drawArrow(op, options);
    } else if (op.tool === "dimension") {
      drawDimension(op, options);
    } else if (op.tool === "freehand") {
      if (op.points && op.points.length > 1) {
        rc.curve(op.points, options);
      }
    }
  }

  function drawArrowHead(tipX, tipY, angle, options, headLen = 14, spread = Math.PI / 7) {
    const hx1 = tipX - headLen * Math.cos(angle - spread);
    const hy1 = tipY - headLen * Math.sin(angle - spread);
    const hx2 = tipX - headLen * Math.cos(angle + spread);
    const hy2 = tipY - headLen * Math.sin(angle + spread);
    rc.line(tipX, tipY, hx1, hy1, options);
    rc.line(tipX, tipY, hx2, hy2, options);
  }

  function drawArrow(op, options) {
    rc.line(op.x1, op.y1, op.x2, op.y2, options);
    const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
    drawArrowHead(op.x2, op.y2, angle, options);
  }

  function drawDimension(op, options) {
    rc.line(op.x1, op.y1, op.x2, op.y2, options);
    const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
    // Arrowheads point outward at each end, touching the extension points —
    // the standard drafting convention, unlike the single-headed arrow tool.
    drawArrowHead(op.x1, op.y1, angle + Math.PI, options, 10, Math.PI / 8);
    drawArrowHead(op.x2, op.y2, angle, options, 10, Math.PI / 8);

    if (op.label) {
      const mx = (op.x1 + op.x2) / 2;
      const my = (op.y1 + op.y2) / 2;
      // Fixed drafting convention rather than following the exact drawn
      // angle: a horizontal dimension's label sits above the line and reads
      // left-to-right; a vertical dimension's label sits to the left and
      // reads bottom-to-top. Either way this holds regardless of which
      // direction the line was dragged in.
      const isVertical = Math.abs(op.y2 - op.y1) > Math.abs(op.x2 - op.x1);
      ctx.save();
      ctx.translate(mx, my);
      if (isVertical) ctx.rotate(-Math.PI / 2);
      ctx.font = "16px 'Patrick Hand', cursive";
      ctx.fillStyle = options.stroke;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(op.label, 0, -8);
      ctx.restore();
    }
  }

  function drawGridDots() {
    if (!snapToGrid) return;
    const isDark = document.documentElement.dataset.theme === "dark";
    ctx.save();
    ctx.fillStyle = isDark ? "rgba(127, 178, 229, 0.4)" : "rgba(58, 110, 165, 0.35)";
    for (let x = 0; x <= canvas.width; x += GRID_SIZE) {
      for (let y = 0; y <= canvas.height; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.arc(x, y, GRID_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGridDots();
    if (!rc) rc = window.rough ? window.rough.canvas(canvas) : null;
    block.operations.forEach(drawOp);
  }

  // --- pointer interaction ---
  let dragging = false;
  let start = null;
  let freehandPoints = null;
  let erasedInThisStroke = false;
  let movingIndex = null;
  let moveOriginalOp = null;
  let recoloredInThisStroke = false;

  function eraseAt(x, y) {
    for (let i = block.operations.length - 1; i >= 0; i--) {
      if (hitTestOperation(block.operations[i], x, y)) {
        if (!erasedInThisStroke) {
          pushUndoSnapshot();
          erasedInThisStroke = true;
        }
        block.operations.splice(i, 1);
        redraw();
        onChange(block.operations);
        return;
      }
    }
  }

  function recolorAt(x, y) {
    for (let i = block.operations.length - 1; i >= 0; i--) {
      const op = block.operations[i];
      if (hitTestOperation(op, x, y)) {
        if (op.colorIndex === activeColorIndex) return;
        if (!recoloredInThisStroke) {
          pushUndoSnapshot();
          recoloredInThisStroke = true;
        }
        block.operations[i] = { ...op, colorIndex: activeColorIndex };
        redraw();
        onChange(block.operations);
        return;
      }
    }
  }

  if (!readOnly) {
  canvas.addEventListener("pointerdown", (evt) => {
    canvas.setPointerCapture(evt.pointerId);
    dragging = true;
    start = pointerPos(evt);
    if (activeTool === "freehand") {
      freehandPoints = [[start.x, start.y]];
    } else if (activeTool === "erase") {
      erasedInThisStroke = false;
      eraseAt(start.x, start.y);
    } else if (activeTool === "recolor") {
      recoloredInThisStroke = false;
      recolorAt(start.x, start.y);
    } else if (activeTool === "move") {
      movingIndex = null;
      moveOriginalOp = null;
      for (let i = block.operations.length - 1; i >= 0; i--) {
        if (hitTestOperation(block.operations[i], start.x, start.y)) {
          movingIndex = i;
          moveOriginalOp = JSON.parse(JSON.stringify(block.operations[i]));
          pushUndoSnapshot();
          break;
        }
      }
    }
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (!dragging) return;
    const pos = pointerPos(evt);
    if (activeTool === "erase") {
      eraseAt(pos.x, pos.y);
      return;
    }
    if (activeTool === "recolor") {
      recolorAt(pos.x, pos.y);
      return;
    }
    if (activeTool === "move") {
      if (movingIndex === null) return;
      block.operations[movingIndex] = translateOp(moveOriginalOp, pos.x - start.x, pos.y - start.y);
      redraw();
      return;
    }
    redraw();
    if (activeTool === "line") {
      drawOp({ tool: "line", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, colorIndex: activeColorIndex });
    } else if (activeTool === "rect") {
      drawOp({
        tool: "rect",
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
        colorIndex: activeColorIndex,
      });
    } else if (activeTool === "circle") {
      const r = Math.hypot(pos.x - start.x, pos.y - start.y);
      drawOp({ tool: "circle", cx: start.x, cy: start.y, r, colorIndex: activeColorIndex });
    } else if (activeTool === "arrow") {
      drawOp({ tool: "arrow", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, colorIndex: activeColorIndex });
    } else if (activeTool === "dimension") {
      drawOp({ tool: "dimension", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, colorIndex: activeColorIndex, label: "" });
    } else if (activeTool === "freehand") {
      freehandPoints.push([pos.x, pos.y]);
      drawOp({ tool: "freehand", points: freehandPoints, colorIndex: activeColorIndex });
    }
  });

  canvas.addEventListener("pointerup", (evt) => {
    if (!dragging) return;
    dragging = false;
    if (activeTool === "erase") {
      erasedInThisStroke = false;
      return;
    }
    if (activeTool === "recolor") {
      recoloredInThisStroke = false;
      return;
    }
    if (activeTool === "move") {
      if (movingIndex !== null) onChange(block.operations);
      movingIndex = null;
      moveOriginalOp = null;
      return;
    }
    const pos = pointerPos(evt);
    const colorIndex = activeColorIndex;
    let op = null;
    if (activeTool === "line" && (pos.x !== start.x || pos.y !== start.y)) {
      op = { tool: "line", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, roughness: ROUGHNESS, strokeWidth: 2, colorIndex };
    } else if (activeTool === "rect" && (pos.x !== start.x || pos.y !== start.y)) {
      op = {
        tool: "rect",
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
        roughness: ROUGHNESS,
        strokeWidth: 2,
        colorIndex,
      };
    } else if (activeTool === "circle") {
      const r = Math.hypot(pos.x - start.x, pos.y - start.y);
      if (r > 1) op = { tool: "circle", cx: start.x, cy: start.y, r, roughness: ROUGHNESS, strokeWidth: 2, colorIndex };
    } else if (activeTool === "arrow" && (pos.x !== start.x || pos.y !== start.y)) {
      op = { tool: "arrow", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, roughness: ROUGHNESS, strokeWidth: 2, colorIndex };
    } else if (activeTool === "dimension" && (pos.x !== start.x || pos.y !== start.y)) {
      const label = prompt('Dimension label (e.g. "B = 2000 mm")', "");
      if (label !== null) {
        op = { tool: "dimension", x1: start.x, y1: start.y, x2: pos.x, y2: pos.y, roughness: ROUGHNESS, strokeWidth: 1, colorIndex, label };
      }
    } else if (activeTool === "freehand" && freehandPoints && freehandPoints.length > 1) {
      op = { tool: "freehand", points: freehandPoints, roughness: ROUGHNESS, strokeWidth: 2, colorIndex };
    }
    if (op) {
      pushUndoSnapshot();
      block.operations.push(op);
      onChange(block.operations);
    }
    freehandPoints = null;
    redraw();
  });

  // Double-click a dimension line, in any tool, to edit its label — this is
  // what "label is editable after placement" means, independent of
  // whichever draw/modify tool happens to be active.
  canvas.addEventListener("dblclick", (evt) => {
    const pos = pointerPos(evt);
    for (let i = block.operations.length - 1; i >= 0; i--) {
      const op = block.operations[i];
      if (op.tool === "dimension" && hitTestOperation(op, pos.x, pos.y)) {
        const newLabel = prompt("Dimension label", op.label || "");
        if (newLabel !== null) {
          pushUndoSnapshot();
          block.operations[i] = { ...op, label: newLabel };
          redraw();
          onChange(block.operations);
        }
        return;
      }
    }
  });
  } // end if (!readOnly) interaction wiring

  redraw();

  // A canvas is just baked pixels — switching themes doesn't repaint it on
  // its own. Listen for the app-wide theme change and redraw so colors
  // re-resolve against the new theme. Self-unsubscribes once this block's
  // canvas is no longer in the document (e.g. deleted, or replaced by a
  // full block-list re-render), so removed blocks don't leak listeners.
  function onThemeChange() {
    if (!canvas.isConnected) {
      window.removeEventListener("themechange", onThemeChange);
      return;
    }
    redraw();
  }
  window.addEventListener("themechange", onThemeChange);

  return wrap;
}

function toolLabel(tool) {
  return (
    {
      line: "Line",
      rect: "Rect",
      circle: "Circle",
      arrow: "Arrow",
      dimension: "Dim",
      freehand: "Freehand",
      move: "Move",
      recolor: "Color",
      erase: "Erase",
    }[tool] || tool
  );
}
