import { escapeHTML, formatAttendanceTime, formatDuration, initials, safeJsonTree } from "./utils.js";

export const STATUS_META = {
  idle: { label: "Chưa quét", icon: "circle-dashed" },
  scanning: { label: "Đang xử lý", icon: "loader-circle" },
  success: { label: "Điểm danh mới", icon: "circle-check-big" },
  already_present: { label: "Đã có mặt trước đó", icon: "check-check" },
  failed: { label: "Thất bại", icon: "circle-x" },
  unknown: { label: "Chưa xác minh", icon: "circle-alert" },
};

export function refreshIcons(root = document) {
  if (globalThis.lucide?.createIcons) globalThis.lucide.createIcons({ attrs: { "aria-hidden": "true" }, root });
}

export function renderSkeleton(container, rows = 4) {
  container.innerHTML = Array.from({ length: rows }, () => `
    <div class="skeleton-row" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
  `).join("");
}

export function renderMembers(container, members, running = false) {
  container.innerHTML = members.map((member) => {
    const meta = STATUS_META[member.status] || STATUS_META.unknown;
    const primaryName = member.server_name || member.display_name || member.alias;
    const secondary = primaryName !== member.alias ? `Alias: ${member.alias}` : "Chưa xác minh danh tính";
    const attendanceTime = formatAttendanceTime(member.result?.scanned_at_iso);
    const simulation = member.result?.is_simulation ? "Mô phỏng máy chủ" : "";
    const avatar = member.avatar_url
      ? `<img src="${escapeHTML(member.avatar_url)}" alt="" loading="lazy" onerror="this.remove()" />`
      : escapeHTML(initials(primaryName));
    return `
      <article class="member-row row-${escapeHTML(member.status)}" data-member-id="${escapeHTML(member.id)}" data-status-label="${escapeHTML(meta.label)}">
        <div class="member-identity">
          <label class="check-control" aria-label="Chọn ${escapeHTML(primaryName)}">
            <input class="member-checkbox" type="checkbox" data-member-id="${escapeHTML(member.id)}" ${member.selected ? "checked" : ""} ${running ? "disabled" : ""} />
            <span aria-hidden="true"><i data-lucide="check"></i><i data-lucide="minus"></i></span>
          </label>
          <span class="avatar">${avatar}</span>
          <span class="identity-copy"><strong>${escapeHTML(primaryName)}</strong><span>${escapeHTML(secondary)}</span></span>
        </div>
        <div class="member-meta"><small>LỚP / STT</small>${escapeHTML(member.class_name || "Chưa có")} ${member.student_number ? ` / ${escapeHTML(member.student_number)}` : ""}</div>
        <div class="member-status"><span class="status-badge status-${escapeHTML(member.status)}"><i data-lucide="${meta.icon}"></i>${escapeHTML(meta.label)}${simulation ? ` · ${escapeHTML(simulation)}` : ""}</span></div>
        <div class="member-time">${attendanceTime || "-"}<small>${attendanceTime ? "Giờ máy chủ" : "Chưa có thời gian"}</small></div>
        <button class="row-action" type="button" data-detail-id="${escapeHTML(member.id)}" aria-label="Xem chi tiết ${escapeHTML(primaryName)}"><i data-lucide="chevron-right"></i></button>
      </article>`;
  }).join("");
  refreshIcons(container);
}

export function renderLogs(container, logs) {
  if (!logs.length) {
    container.innerHTML = `<div class="terminal-empty"><span>Chưa có sự kiện phù hợp với bộ lọc.</span></div>`;
    return;
  }
  container.innerHTML = logs.map((log) => `
    <div class="log-line">
      <span class="log-time">[${escapeHTML(log.time)}]</span>
      <span class="log-level level-${escapeHTML(log.level)}">${escapeHTML(log.level)}</span>
      <span class="log-message">${log.member ? `<span class="log-member">${escapeHTML(log.member)}: </span>` : ""}${escapeHTML(log.message)}</span>
      <span class="log-elapsed">${escapeHTML(log.elapsed || "")}</span>
    </div>`).join("");
}

export function confirmationDialog(selected, candidates) {
  const skipped = selected.filter((member) => !candidates.some((candidate) => candidate.id === member.id));
  const unknown = candidates.filter((member) => member.status === "unknown");
  return `
    <div class="dialog-head"><div><h2 id="dialog-title">Xác nhận hàng đợi quét</h2><p>Chỉ các thành viên trong danh sách gửi POST mới được xử lý.</p></div><button class="icon-button" type="button" data-dialog-close aria-label="Đóng"><i data-lucide="x"></i></button></div>
    <div class="dialog-body">
      <div class="dialog-summary"><div><span>Đã chọn</span><strong>${selected.length}</strong></div><div><span>Sẽ gửi POST</span><strong>${candidates.length}</strong></div><div><span>Bỏ qua an toàn</span><strong>${skipped.length}</strong></div></div>
      <div class="dialog-list">${selected.map((member) => `<div class="dialog-list-item"><strong>${escapeHTML(member.server_name || member.alias)}</strong><span>${candidates.some((candidate) => candidate.id === member.id) ? "Sẽ xử lý" : "Đã xác nhận có mặt"}</span></div>`).join("")}</div>
      ${unknown.length ? `<div class="dialog-warning"><i data-lucide="triangle-alert"></i><span>${unknown.length} thành viên đang ở trạng thái chưa xác minh. Thao tác này sẽ gửi một request mới sau khi bạn xác nhận.</span></div>` : ""}
    </div>
    <div class="dialog-actions"><button class="button button-quiet" type="button" data-dialog-close>Hủy</button><button class="button button-primary" type="button" data-dialog-confirm ${candidates.length ? "" : "disabled"}><i data-lucide="scan-line"></i>Xác nhận quét ${candidates.length} người</button></div>`;
}

export function summaryDialog(summary) {
  const counts = { success: 0, already_present: 0, failed: 0, unknown: 0 };
  summary.results.forEach((result) => { counts[result.status] = (counts[result.status] || 0) + 1; });
  return `
    <div class="dialog-head"><div><h2 id="dialog-title">${summary.stopped ? "Hàng đợi đã dừng" : "Hoàn tất hàng đợi"}</h2><p>${summary.stopped ? "Request đang chạy đã hoàn tất, không gửi thêm người tiếp theo." : "Tất cả request trong snapshot đã được xử lý."}</p></div><button class="icon-button" type="button" data-dialog-close aria-label="Đóng"><i data-lucide="x"></i></button></div>
    <div class="dialog-body">
      <div class="dialog-summary"><div><span>Đã xử lý</span><strong>${summary.results.length}</strong></div><div><span>Điểm danh mới</span><strong>${counts.success}</strong></div><div><span>Đã có mặt</span><strong>${counts.already_present}</strong></div><div><span>Thất bại</span><strong>${counts.failed}</strong></div><div><span>Chưa xác minh</span><strong>${counts.unknown}</strong></div><div><span>Bỏ qua</span><strong>${summary.skipped}</strong></div></div>
      <div class="dialog-list">${summary.results.map((result) => `<div class="dialog-list-item"><strong>${escapeHTML(result.member_id)}</strong><span>${escapeHTML(STATUS_META[result.status]?.label || "Chưa xác minh")}</span></div>`).join("")}</div>
      <div class="dialog-warning"><i data-lucide="timer"></i><span>Thời lượng xử lý: ${escapeHTML(formatDuration(summary.durationMs))}. Progress phản ánh số request đã kết thúc, không phải tỷ lệ thành công.</span></div>
    </div>
    <div class="dialog-actions"><button class="button button-quiet" type="button" data-summary-export><i data-lucide="download"></i>Tải kết quả CSV</button><button class="button button-primary" type="button" data-dialog-close>Đóng</button></div>`;
}

export function renderDrawer(drawer, member) {
  const result = member.result;
  const meta = STATUS_META[member.status] || STATUS_META.unknown;
  const name = member.server_name || member.display_name || member.alias;
  drawer.innerHTML = `
    <div class="drawer-head"><div><h2 id="drawer-title">Chi tiết kết quả</h2><p>Response đã được loại bỏ dữ liệu nhạy cảm</p></div><button id="close-drawer" class="icon-button" type="button" aria-label="Đóng chi tiết"><i data-lucide="x"></i></button></div>
    <div class="drawer-content">
      <div class="drawer-profile"><span class="avatar">${escapeHTML(initials(name))}</span><div><h3>${escapeHTML(name)}</h3><p>Alias: ${escapeHTML(member.alias)}${member.class_name ? ` · Lớp ${escapeHTML(member.class_name)}` : ""}</p></div></div>
      <dl class="detail-grid">
        <div><dt>Trạng thái chuẩn hóa</dt><dd><span class="status-badge status-${escapeHTML(member.status)}"><i data-lucide="${meta.icon}"></i>${escapeHTML(meta.label)}</span></dd></div>
        <div><dt>HTTP status</dt><dd>${escapeHTML(result?.http_status ?? "Chưa có")}</dd></div>
        <div><dt>Số thứ tự</dt><dd>${escapeHTML(member.student_number || "Chưa có")}</dd></div>
        <div><dt>Vai trò</dt><dd>${escapeHTML(member.role || result?.student?.role || "Chưa có")}</dd></div>
        <div><dt>Attendance status</dt><dd>${escapeHTML(result?.attendance_status || "Chưa có")}</dd></div>
        <div><dt>Thời gian điểm danh</dt><dd>${escapeHTML(formatAttendanceTime(result?.scanned_at_iso) || "Chưa có")}</dd></div>
        <div><dt>Gửi request</dt><dd>${escapeHTML(result?.requested_at || "Chưa có")}</dd></div>
        <div><dt>Nhận response</dt><dd>${escapeHTML(result?.response_received_at || "Chưa có")}</dd></div>
        <div><dt>Thời lượng</dt><dd>${escapeHTML(formatDuration(result?.duration_ms))}</dd></div>
        <div><dt>Nguồn dữ liệu</dt><dd>${result?.is_simulation ? "Mô phỏng từ server" : "Máy chủ thực tế"}</dd></div>
      </dl>
      <dl class="detail-grid"><div><dt>Thông báo máy chủ</dt><dd>${escapeHTML(result?.message || "Chưa có response")}</dd></div><div><dt>Giải thích</dt><dd>${escapeHTML(result?.reason || "Kết quả phù hợp quy tắc nghiệp vụ đã quan sát.")}</dd></div></dl>
      <section class="json-panel"><div class="json-head"><strong>Sanitized JSON</strong><button id="copy-json" class="text-button" type="button">Sao chép JSON</button></div><div id="json-view" class="json-view"></div></section>
    </div>`;
  const jsonView = drawer.querySelector("#json-view");
  jsonView.append(safeJsonTree(result?.sanitized_response || result || { status: "idle" }));
  refreshIcons(drawer);
}

