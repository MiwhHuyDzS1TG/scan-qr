export const TZ = "Asia/Ho_Chi_Minh";

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function uniqueId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function formatClock(value = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
}

export function formatDate(value = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
}

export function formatAttendanceTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "-";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function initials(value) {
  const parts = String(value || "?").trim().split(/\s+/).filter(Boolean);
  return parts.slice(-2).map((part) => part[0]).join("").toUpperCase();
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function safeJsonTree(value, key = null) {
  const wrap = document.createElement("div");
  if (value !== null && typeof value === "object") {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${key === null ? "response" : key} ${Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`}`;
    details.append(summary);
    Object.entries(value).forEach(([childKey, childValue]) => details.append(safeJsonTree(childValue, childKey)));
    wrap.append(details);
    return wrap;
  }
  const keyNode = document.createElement("span");
  keyNode.className = "json-key";
  keyNode.textContent = key === null ? "value" : key;
  const valueNode = document.createElement("span");
  valueNode.className = value === null ? "json-null" : `json-${typeof value}`;
  valueNode.textContent = value === null ? "null" : typeof value === "string" ? `"${value}"` : String(value);
  wrap.append(keyNode, document.createTextNode(": "), valueNode);
  return wrap;
}

