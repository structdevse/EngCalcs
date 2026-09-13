// Tooltip popups are positioned via JS-computed viewport coordinates
// (position: fixed) rather than CSS-relative placement (position: absolute
// + bottom: 100%), and shown/hidden via a JS-toggled .visible class rather
// than :hover/:focus-within. Two things force this:
//
// 1. Text block previews have overflow: auto (needed so a manually
//    shrunk block scrolls instead of clipping its own text) — CSS forces
//    overflow-x to auto too whenever overflow-y is auto, so an
//    absolutely-positioned popup poking out past the preview's own box
//    (which it does whenever it doesn't fit directly below/above the
//    trigger) gets silently clipped by that same box.
// 2. A trigger whose text wraps across two lines has an unreliable
//    containing-block position under position: absolute, putting the
//    popup somewhere visually unrelated to the trigger.
//
// position: fixed escapes both: ancestor overflow doesn't clip it (no
// ancestor here uses transform/filter/perspective, which would otherwise
// give fixed-position elements a different containing block), and its
// position comes from an explicit getBoundingClientRect() call rather
// than CSS's containing-block math.
export function wireTooltipPopups(container) {
  function popupFor(trigger) {
    return trigger.querySelector(":scope > .text-tooltip-popup");
  }

  function show(trigger) {
    const popup = popupFor(trigger);
    if (!popup) return;
    popup.classList.add("visible");

    const rects = trigger.getClientRects();
    const rect = rects[rects.length - 1] || trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    let left = rect.left;
    left = Math.min(left, window.innerWidth - popupRect.width - 8);
    left = Math.max(8, left);

    let top = rect.top - popupRect.height - 6;
    if (top < 4) top = rect.bottom + 6; // not enough room above — show below instead

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function hide(trigger) {
    const popup = popupFor(trigger);
    if (popup) popup.classList.remove("visible");
  }

  container.addEventListener("mouseover", (evt) => {
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (trigger) show(trigger);
  });
  container.addEventListener("mouseout", (evt) => {
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (trigger && !trigger.contains(evt.relatedTarget)) hide(trigger);
  });
  container.addEventListener("focusin", (evt) => {
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (trigger) show(trigger);
  });
  container.addEventListener("focusout", (evt) => {
    const trigger = evt.target.closest(".text-tooltip-trigger");
    if (trigger && !trigger.contains(evt.relatedTarget)) hide(trigger);
  });
}
