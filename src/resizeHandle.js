// Adds a draggable bottom-right resize handle to `container`, which must be
// position:relative (or absolute) for the handle to anchor correctly.
// onResize(width, height) fires continuously while dragging (for live
// visual feedback); onResizeEnd(width, height) fires once, when the drag
// finishes — that's the point to persist the new size to state, rather
// than on every pixel of movement.
export function attachResizeHandle(
  container,
  { axis = "both", minWidth = 120, minHeight = 60, maxWidth = 1200, minHeightFloor = 40, onResize, onResizeEnd } = {}
) {
  const handle = document.createElement("div");
  handle.className = "resize-handle";
  if (axis === "vertical") handle.classList.add("axis-vertical");
  if (axis === "horizontal") handle.classList.add("axis-horizontal");
  handle.title = "Drag to resize";

  function clamp(w, h) {
    return {
      width: Math.min(maxWidth, Math.max(minWidth, Math.round(w))),
      height: Math.max(minHeightFloor, Math.round(h)),
    };
  }

  handle.addEventListener("pointerdown", (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    handle.setPointerCapture(evt.pointerId);
    const startX = evt.clientX;
    const startY = evt.clientY;
    const rect = container.getBoundingClientRect();
    const startWidth = rect.width;
    const startHeight = rect.height;

    function sizeFor(moveEvt) {
      let w = startWidth;
      let h = startHeight;
      if (axis !== "vertical") w = startWidth + (moveEvt.clientX - startX);
      if (axis !== "horizontal") h = startHeight + (moveEvt.clientY - startY);
      return clamp(w, h);
    }

    function onMove(moveEvt) {
      const { width, height } = sizeFor(moveEvt);
      onResize(width, height);
    }

    function onUp(upEvt) {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      // Explicit release rather than relying solely on the implicit
      // release browsers are supposed to do on pointerup — belt and
      // braces, since a stray still-captured pointer would hijack
      // whatever the user clicks next, anywhere on the page.
      try {
        handle.releasePointerCapture(upEvt.pointerId);
      } catch (e) {
        // already released — fine
      }
      const { width, height } = sizeFor(upEvt);
      if (onResizeEnd) onResizeEnd(width, height);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });

  container.appendChild(handle);
  return handle;
}
