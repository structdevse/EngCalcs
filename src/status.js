export const STATUSES = ["draft", "checked", "superseded"];

export function statusLabel(status) {
  return { draft: "Draft", checked: "Checked", superseded: "Superseded" }[
    status
  ] || status;
}

// Dropdown for the sheet header. Calls onChange(status) on selection.
export function createStatusDropdown(currentStatus, onChange) {
  const select = document.createElement("select");
  select.className = `status-select status-${currentStatus}`;
  STATUSES.forEach((status) => {
    const opt = document.createElement("option");
    opt.value = status;
    opt.textContent = statusLabel(status);
    opt.selected = status === currentStatus;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    select.className = `status-select status-${select.value}`;
    onChange(select.value);
  });
  return select;
}

// Small read-only badge, used in the file browser list.
export function createStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `status-badge status-${status}`;
  badge.textContent = statusLabel(status);
  return badge;
}

// Updates the page watermark to reflect the sheet's current status.
export function updateWatermark(watermarkEl, status) {
  watermarkEl.textContent = status === "draft" ? "" : statusLabel(status).toUpperCase();
  watermarkEl.className = `page-watermark status-${status}`;
}
