import { api } from "./api.js";
import {
  STATUS_META,
  confirmationDialog,
  refreshIcons,
  renderDrawer,
  renderLogs,
  renderMembers,
  renderSkeleton,
  summaryDialog,
} from "./components.js";
import { ScanQueue } from "./scan-queue.js";
import {
  applyResult,
  createState,
  hydrateMembers,
  queueCandidates,
  selectedMembers,
  statusCounts,
  toggleVisibleSelection,
  visibleMembers,
} from "./state.js";
import { csvEscape, downloadFile, formatClock, formatDate, formatDuration, uniqueId } from "./utils.js";

const state = createState();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let lastFocused = null;
let currentSummary = null;

const elements = {
  loginView: $("#login-view"), appView: $("#app-view"), loginForm: $("#login-form"), loginButton: $("#login-button"), loginError: $("#login-error"),
  memberList: $("#member-list"), memberEmpty: $("#member-empty"), memberSearch: $("#member-search"), filterTabs: $("#filter-tabs"), selectVisible: $("#select-visible"), clearSelection: $("#clear-selection"),
  scanButton: $("#scan-button"), stopButton: $("#stop-button"), progressWrap: $("#progress-wrap"), terminalBody: $("#terminal-body"),
  modalBackdrop: $("#modal-backdrop"), dialog: $("#dialog"), drawer: $("#detail-drawer"), drawerBackdrop: $("#drawer-backdrop"), toastRegion: $("#toast-region"),
  sidebar: $("#sidebar"), mobileBackdrop: $("#mobile-backdrop"), mobileMenu: $("#mobile-menu"), systemStatus: $("#system-status"),
};

function announce(message) { $("#screen-reader-status").textContent = message; }

function toast(message, type = "info") {
  const icons = { info: "info", success: "circle-check-big", error: "circle-x", warning: "triangle-alert" };
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.innerHTML = `<i data-lucide="${icons[type] || icons.info}"></i><span></span>`;
  node.querySelector("span").textContent = message;
  elements.toastRegion.append(node);
  refreshIcons(node);
  setTimeout(() => node.remove(), 4200);
}

function addLog(level, message, member = "") {
  const elapsed = state.batch.startedAt ? formatDuration(Math.round(performance.now() - state.batch.startedAt)) : "";
  state.logs.push({ id: uniqueId("log"), time: formatClock(), level, message, member, elapsed });
  renderLogPanel();
}

function filteredLogs() {
  return state.logs.filter((log) => (state.logLevel === "all" || log.level === state.logLevel) && (state.logMember === "all" || log.member === state.logMember));
}

function renderLogPanel() {
  const shouldScroll = elements.terminalBody.scrollHeight - elements.terminalBody.scrollTop - elements.terminalBody.clientHeight < 48;
  const logs = filteredLogs();
  renderLogs(elements.terminalBody, logs);
  $("#log-count").textContent = `${state.logs.length} sự kiện trong phiên`;
  if (shouldScroll) elements.terminalBody.scrollTop = elements.terminalBody.scrollHeight;
}

function updateMemberFilterOptions() {
  const select = $("#log-member-filter");
  const value = select.value;
  select.innerHTML = `<option value="all">Mọi thành viên</option>${state.members.map((member) => `<option value="${member.id}">${member.alias}</option>`).join("")}`;
  select.value = state.members.some((member) => member.id === value) ? value : "all";
}

function updateCounts() {
  const counts = statusCounts(state);
  $("#metric-total").textContent = counts.all;
  $("#metric-selected").textContent = counts.selected;
  $("#metric-success").textContent = counts.realSuccess;
  $("#metric-present").textContent = counts.realPresent;
  $("#metric-failed").textContent = counts.realFailed;
  $("#metric-unknown").textContent = counts.realUnknown;
  $("#verified-total").textContent = counts.verified;
  $("#presence-new").textContent = counts.realSuccess;
  $("#presence-existing").textContent = counts.realPresent;
  $("#selected-orbit").textContent = counts.selected;
  $("#selected-label").textContent = counts.selected ? `${counts.selected} thành viên đã chọn` : "Chưa chọn thành viên";
  $("#selected-helper").textContent = counts.selected ? `${queueCandidates(state).length} người đủ điều kiện gửi trong lượt kế tiếp.` : "Chọn ít nhất một người để bắt đầu.";
  $$(".filter-tab").forEach((button) => {
    const key = button.dataset.filter;
    const counter = button.querySelector("span");
    if (counter) counter.textContent = counts[key] ?? 0;
  });
  const candidates = queueCandidates(state).length;
  elements.scanButton.disabled = counts.selected === 0 || candidates === 0 || state.batch.running;
  elements.scanButton.querySelector("span").textContent = counts.selected
    ? candidates ? `Quét ${candidates} thành viên` : "Không có request mới"
    : "Bắt đầu quét";
}

function renderMemberPanel() {
  const members = visibleMembers(state);
  renderMembers(elements.memberList, members, state.batch.running);
  elements.memberList.hidden = members.length === 0;
  elements.memberEmpty.hidden = members.length !== 0;
  $("#visible-count").textContent = `${members.length} thành viên`;
  const selectedVisible = members.filter((member) => member.selected).length;
  elements.selectVisible.checked = members.length > 0 && selectedVisible === members.length;
  elements.selectVisible.indeterminate = selectedVisible > 0 && selectedVisible < members.length;
  elements.selectVisible.disabled = state.batch.running || members.length === 0;
  elements.clearSelection.disabled = state.batch.running;
  updateCounts();
}

function setProgress(processed, total, current = null, results = []) {
  elements.progressWrap.hidden = false;
  const percentage = total ? Math.round((processed / total) * 100) : 0;
  $("#progress-bar").style.width = `${percentage}%`;
  $(".progress-track").setAttribute("aria-valuenow", String(percentage));
  $("#progress-count").textContent = `${processed}/${total}`;
  $("#progress-current").textContent = current ? `Đang xử lý ${current}` : processed === total ? "Đã xử lý xong" : "Đang chuẩn bị";
  const counts = { success: 0, already_present: 0, failed: 0, unknown: 0 };
  results.forEach((result) => { counts[result.status] = (counts[result.status] || 0) + 1; });
  $("#progress-success").textContent = counts.success;
  $("#progress-present").textContent = counts.already_present;
  $("#progress-failed").textContent = counts.failed;
  $("#progress-unknown").textContent = counts.unknown;
}

function setQueueUi(running, stopping = false) {
  state.batch.running = running;
  state.batch.stopping = stopping;
  elements.stopButton.hidden = !running;
  elements.stopButton.disabled = stopping;
  $("#queue-state").innerHTML = running
    ? `<i data-lucide="${stopping ? "octagon" : "loader-circle"}"></i> ${stopping ? "Đang dừng" : "Đang xử lý"}`
    : `<i data-lucide="pause"></i> Đang chờ`;
  refreshIcons($("#queue-state"));
  renderMemberPanel();
}

function resultLog(result, alias) {
  if (result.http_status) addLog("HTTP", `${result.http_status} - Đã nhận phản hồi`, alias);
  const map = { success: "SUCCESS", already_present: "EXISTS", failed: "ERROR", unknown: "WARN" };
  addLog(map[result.status] || "WARN", result.message || STATUS_META[result.status]?.label || "Chưa xác minh", alias);
  if (result.scanned_at_iso) addLog("INFO", `Thời gian điểm danh từ máy chủ: ${result.scanned_at_iso}`, alias);
  if (result.reason) addLog("INFO", result.reason, alias);
  addLog("DONE", `Hoàn tất xử lý trong ${formatDuration(result.duration_ms)}`, alias);
}

const queue = new ScanQueue({
  scan: (memberId, batchId, requestId) => api.scan(memberId, batchId, requestId),
  onStart: ({ batchId, members }) => {
    state.batch = { running: true, stopping: false, id: batchId, total: members.length, processed: 0, current: null, startedAt: performance.now(), skipped: 0, results: [] };
    setQueueUi(true);
    setProgress(0, members.length, null, []);
    addLog("INFO", `Bắt đầu batch ${batchId.slice(-8)} với ${members.length} thành viên`);
  },
  onMemberStart: ({ member, index, total }) => {
    const target = state.members.find((item) => item.id === member.id);
    if (target) target.status = "scanning";
    state.batch.current = member.id;
    setProgress(index, total, member.alias, state.batch.results);
    renderMemberPanel();
    addLog("SEND", "Đang gửi một POST", member.alias);
    announce(`Đang xử lý ${member.alias}`);
  },
  onResult: ({ member, result }) => {
    const target = state.members.find((item) => item.id === member.id);
    if (target) applyResult(target, result);
    state.batch.results.push(result);
    resultLog(result, member.alias);
    $("#last-updated").textContent = `Cập nhật lúc ${formatClock()}`;
    renderMemberPanel();
    toast(`${member.alias}: ${STATUS_META[result.status]?.label || "Chưa xác minh"}`, result.status === "success" ? "success" : result.status === "failed" ? "error" : result.status === "unknown" ? "warning" : "info");
  },
  onError: ({ member, result }) => {
    const target = state.members.find((item) => item.id === member.id);
    if (target) applyResult(target, result);
    state.batch.results.push(result);
    resultLog(result, member.alias);
    renderMemberPanel();
    toast(`${member.alias}: Không thể xác minh kết quả`, "warning");
  },
  onProgress: ({ processed, total, results }) => {
    state.batch.processed = processed;
    state.batch.results = results;
    setProgress(processed, total, null, results);
  },
  onComplete: (summary) => {
    state.batch.skipped = summary.skipped;
    setQueueUi(false);
    setProgress(summary.results.length, summary.results.length + summary.skipped, null, summary.results);
    addLog("INFO", summary.stopped ? `Đã dừng hàng đợi, còn ${summary.skipped} thành viên chưa xử lý` : "Đã hoàn tất batch");
    currentSummary = summary;
    openModal(summaryDialog(summary));
    announce(summary.stopped ? "Hàng đợi đã dừng" : "Hàng đợi đã hoàn tất");
  },
});

function focusableIn(root) { return $$("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])", root); }

function openModal(content) {
  lastFocused = document.activeElement;
  elements.dialog.innerHTML = content;
  elements.modalBackdrop.hidden = false;
  document.body.style.overflow = "hidden";
  refreshIcons(elements.dialog);
  requestAnimationFrame(() => focusableIn(elements.dialog)[0]?.focus());
}

function closeModal() {
  elements.modalBackdrop.hidden = true;
  elements.dialog.innerHTML = "";
  document.body.style.overflow = "";
  lastFocused?.focus?.();
}

function openDrawer(member) {
  lastFocused = document.activeElement;
  elements.drawer.dataset.memberId = member.id;
  renderDrawer(elements.drawer, member);
  elements.drawerBackdrop.hidden = false;
  elements.drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => { elements.drawer.classList.add("open"); $("#close-drawer", elements.drawer)?.focus(); });
}

function closeDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawerBackdrop.hidden = true;
  lastFocused?.focus?.();
}

function summaryCsv(summary) {
  const headers = ["member_id", "status", "http_status", "message", "requested_at", "response_received_at", "scanned_at_iso", "duration_ms"];
  return [headers.join(","), ...summary.results.map((result) => headers.map((key) => csvEscape(result[key])).join(","))].join("\n");
}

async function checkHealth(showToast = false, probe = false) {
  setSystemStatus("checking", "Đang kiểm tra");
  try {
    const health = await api.health(probe);
    state.health = health;
    $("#setting-mode").textContent = "Điểm danh thực tế";
    $("#setting-members").textContent = health.configuration.members_loaded;
    const status = health.upstream.status;
    if (status === "ready") setSystemStatus("ready", "Sẵn sàng");
    else if (status === "checking_required") setSystemStatus("warning", "Chưa kiểm tra");
    else if (status === "missing_configuration") setSystemStatus("warning", "Thiếu cấu hình");
    else if (status === "session_expired") setSystemStatus("error", "Phiên đã hết hạn");
    else setSystemStatus("error", "Không thể kết nối");
    if (showToast) toast("Đã cập nhật trạng thái hệ thống", status === "ready" ? "success" : "warning");
  } catch (error) {
    setSystemStatus("error", "Không thể kết nối");
    if (showToast) toast(error.message, "error");
  }
}

function setSystemStatus(kind, label) {
  const icon = { checking: "loader-circle", ready: "circle-check", warning: "triangle-alert", error: "unplug" }[kind];
  elements.systemStatus.className = `status-chip status-${kind}`;
  elements.systemStatus.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  refreshIcons(elements.systemStatus);
}

async function initializeApp(session) {
  state.session = session;
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  $("#session-user").textContent = session.username;
  $("#session-mode").textContent = "Điểm danh thực tế";
  $("#mode-badge").textContent = "LIVE";
  $("#setting-mode").textContent = "Điểm danh thực tế";
  renderSkeleton(elements.memberList);
  refreshIcons();
  try {
    const data = await api.members();
    state.members = hydrateMembers(data.members);
    $("#setting-members").textContent = state.members.length;
    updateMemberFilterOptions();
    renderMemberPanel();
    addLog("INFO", `Đã nạp ${state.members.length} thành viên, không tải QR data xuống trình duyệt`);
    await checkHealth(false, false);
  } catch (error) {
    toast(error.message, "error");
    if (error.status === 401) showLogin();
  }
}

function showLogin() {
  elements.loginView.hidden = false;
  elements.appView.hidden = true;
  state.session = null;
  $("#username").focus();
}

async function bootstrap() {
  const savedTheme = localStorage.getItem("acc-theme");
  const theme = savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = theme;
  updateThemeIcon();
  tickClock();
  setInterval(tickClock, 1000);
  refreshIcons();
  try {
    const session = await api.session();
    if (session.authenticated) await initializeApp(session);
    else showLogin();
  } catch (error) {
    elements.loginError.hidden = false;
    elements.loginError.textContent = `Không thể khởi tạo ứng dụng: ${error.message}`;
  }
}

function tickClock() { $("#current-time").textContent = formatClock(); $("#current-date").textContent = formatDate(); }
function updateThemeIcon() { $("#theme-toggle").innerHTML = `<i data-lucide="${document.documentElement.dataset.theme === "dark" ? "sun" : "moon"}"></i>`; refreshIcons($("#theme-toggle")); }

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.hidden = true;
  elements.loginButton.disabled = true;
  elements.loginButton.querySelector("span").textContent = "Đang xác thực";
  try {
    const session = await api.login($("#username").value.trim(), $("#password").value);
    $("#password").value = "";
    await initializeApp(session);
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginError.hidden = false;
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.querySelector("span").textContent = "Đăng nhập an toàn";
  }
});

$("#logout-button").addEventListener("click", async () => {
  if (state.batch.running) return toast("Hãy dừng hàng đợi trước khi đăng xuất", "warning");
  try { await api.logout(); } finally { location.reload(); }
});

elements.memberSearch.addEventListener("input", (event) => { state.search = event.target.value; renderMemberPanel(); });
elements.filterTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  $$(".filter-tab").forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); });
  renderMemberPanel();
});
elements.selectVisible.addEventListener("change", (event) => { if (!state.batch.running) { toggleVisibleSelection(state, event.target.checked); renderMemberPanel(); } });
elements.clearSelection.addEventListener("click", () => { if (!state.batch.running) { state.members.forEach((member) => { member.selected = false; }); renderMemberPanel(); } });
elements.memberList.addEventListener("change", (event) => {
  if (!event.target.matches(".member-checkbox") || state.batch.running) return;
  const member = state.members.find((item) => item.id === event.target.dataset.memberId);
  if (member) member.selected = event.target.checked;
  renderMemberPanel();
});
elements.memberList.addEventListener("click", (event) => {
  const detail = event.target.closest("[data-detail-id]");
  if (!detail) return;
  const member = state.members.find((item) => item.id === detail.dataset.detailId);
  if (member) openDrawer(member);
});

elements.scanButton.addEventListener("click", () => {
  if (state.batch.running) return;
  const selected = selectedMembers(state);
  const candidates = queueCandidates(state);
  openModal(confirmationDialog(selected, candidates));
});
elements.stopButton.addEventListener("click", () => {
  if (queue.requestStop()) {
    setQueueUi(true, true);
    addLog("WARN", "Yêu cầu dừng đã ghi nhận. Request hiện tại vẫn được chờ hoàn tất");
    toast("Sẽ dừng trước thành viên tiếp theo", "warning");
  }
});

elements.modalBackdrop.addEventListener("click", async (event) => {
  if (event.target === elements.modalBackdrop || event.target.closest("[data-dialog-close]")) return closeModal();
  if (event.target.closest("[data-dialog-confirm]")) {
    if (queue.running) return;
    const candidates = queueCandidates(state);
    closeModal();
    await queue.run(candidates);
  }
  if (event.target.closest("[data-summary-export]") && currentSummary) {
    downloadFile(`attendance-${currentSummary.batchId}.csv`, summaryCsv(currentSummary), "text/csv;charset=utf-8");
    toast("Đã tạo file kết quả CSV", "success");
  }
});

elements.dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const items = focusableIn(elements.dialog);
  if (!items.length) return;
  const first = items[0]; const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

elements.drawerBackdrop.addEventListener("click", closeDrawer);
elements.drawer.addEventListener("click", async (event) => {
  if (event.target.closest("#close-drawer")) closeDrawer();
  if (event.target.closest("#copy-json")) {
    const memberId = elements.drawer.dataset.memberId;
    const member = state.members.find((item) => item.id === memberId);
    await navigator.clipboard.writeText(JSON.stringify(member?.result?.sanitized_response || member?.result || {}, null, 2));
    toast("Đã sao chép JSON đã làm sạch", "success");
  }
});
$("#reset-filter").addEventListener("click", () => { state.filter = "all"; state.search = ""; elements.memberSearch.value = ""; $("[data-filter='all']").click(); });
$("#focus-scan").addEventListener("click", () => { $("#attendance").scrollIntoView({ behavior: "smooth" }); elements.scanButton.focus(); });
$("#admin-menu").addEventListener("click", () => $("#settings").scrollIntoView({ behavior: "smooth" }));
elements.systemStatus.addEventListener("click", () => checkHealth(true, true));

$("#theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("acc-theme", next);
  updateThemeIcon();
});
$("#collapse-sidebar").addEventListener("click", (event) => {
  const collapsed = elements.sidebar.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-pressed", String(collapsed));
  event.currentTarget.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
  refreshIcons(event.currentTarget);
});
function closeMobileNav() { elements.sidebar.classList.remove("mobile-open"); elements.mobileBackdrop.hidden = true; elements.mobileMenu.setAttribute("aria-expanded", "false"); }
elements.mobileMenu.addEventListener("click", () => { const open = elements.sidebar.classList.toggle("mobile-open"); elements.mobileBackdrop.hidden = !open; elements.mobileMenu.setAttribute("aria-expanded", String(open)); });
elements.mobileBackdrop.addEventListener("click", closeMobileNav);
$$('[data-nav]').forEach((link) => link.addEventListener("click", () => {
  $$('[data-nav]').forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
  const labels = { overview: "Tổng quan", attendance: "Điểm danh", logs: "Nhật ký", settings: "Cài đặt" };
  $("#breadcrumb-page").textContent = labels[link.dataset.nav] || "Tổng quan";
  closeMobileNav();
}));

$("#log-level-filter").addEventListener("change", (event) => { state.logLevel = event.target.value; renderLogPanel(); });
$("#log-member-filter").addEventListener("change", (event) => { state.logMember = event.target.value; renderLogPanel(); });
$("#clear-logs").addEventListener("click", () => { state.logs = []; renderLogPanel(); toast("Đã xóa nhật ký hiển thị", "info"); });
$("#copy-logs").addEventListener("click", async () => {
  const text = filteredLogs().map((log) => `[${log.time}] ${log.level.padEnd(7)} ${log.member ? `${log.member}: ` : ""}${log.message}`).join("\n");
  await navigator.clipboard.writeText(text);
  toast("Đã sao chép nhật ký", "success");
});
$("#export-logs").addEventListener("click", () => {
  const rows = [["time", "level", "member", "message", "elapsed"], ...filteredLogs().map((log) => [log.time, log.level, log.member, log.message, log.elapsed])];
  downloadFile("attendance-session-logs.csv", rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "text/csv;charset=utf-8");
  toast("Đã tạo file nhật ký CSV", "success");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!elements.modalBackdrop.hidden) closeModal();
    else if (elements.drawer.classList.contains("open")) closeDrawer();
    else closeMobileNav();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && state.session) { event.preventDefault(); elements.memberSearch.focus(); }
  if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "g" && state.session && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { $("#attendance").scrollIntoView(); elements.scanButton.focus(); }
});

bootstrap();

