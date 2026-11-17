from __future__ import annotations

import re
import unicodedata
from typing import Any
from urllib.parse import quote, urlparse

from backend.schemas import NormalizedAttendance, StudentInfo


PRESENT_MESSAGES = (
    "đã điểm danh rồi",
    "da diem danh roi",
    "already checked in",
    "already present",
)
FAILURE_MESSAGES = (
    "không hợp lệ",
    "khong hop le",
    "thất bại",
    "that bai",
    "không tìm thấy",
    "khong tim thay",
    "từ chối",
    "tu choi",
)


def _fold(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    folded = "".join(char for char in text if not unicodedata.combining(char))
    return folded.replace("đ", "d").strip()


def _safe_avatar(value: object) -> str | None:
    if not isinstance(value, str) or not value.startswith("/storage/avatars/"):
        return None
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or ".." in parsed.path:
        return None
    if not re.fullmatch(r"/storage/avatars/[A-Za-z0-9_./-]{1,300}", parsed.path):
        return None
    return parsed.path


def sanitize_response(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    safe: dict[str, Any] = {}
    for key in ("success", "is_simulation", "message", "scanned_at", "scanned_at_iso", "attendance_status"):
        value = data.get(key)
        if isinstance(value, (str, bool, int, float)) or value is None:
            safe[key] = value
    student = data.get("student")
    if isinstance(student, dict):
        safe_student: dict[str, Any] = {}
        for key in ("name", "class_name", "role", "student_number"):
            value = student.get(key)
            if isinstance(value, (str, int, float)) or value is None:
                safe_student[key] = value
        avatar = _safe_avatar(student.get("avatar"))
        if avatar:
            safe_student["avatar"] = avatar
        safe["student"] = safe_student
    return safe


def _student_info(data: dict[str, Any] | None, member_id: str) -> StudentInfo | None:
    if not data or not isinstance(data.get("student"), dict):
        return None
    student = data["student"]
    avatar = _safe_avatar(student.get("avatar"))
    return StudentInfo(
        name=student.get("name"),
        class_name=student.get("class_name"),
        student_number=student.get("student_number"),
        role=student.get("role"),
        avatar=avatar,
        avatar_url=f"/api/avatar?path={quote(avatar, safe='')}" if avatar else None,
    )


def _identity_mismatch(student: StudentInfo | None, expected: dict[str, str] | None) -> str | None:
    if not student or not expected:
        return None
    checks = (
        ("display_name", student.name, "tên"),
        ("class_name", student.class_name, "lớp"),
        ("student_number", student.student_number, "số thứ tự"),
    )
    mismatches = [label for key, actual, label in checks if expected.get(key) and actual and _fold(expected[key]) != _fold(actual)]
    if mismatches:
        return "Thông tin học sinh không khớp ở: " + ", ".join(mismatches) + "."
    return None


def normalize_attendance_response(
    *,
    member_id: str,
    http_status: int | None,
    data: Any,
    requested_at: str,
    response_received_at: str,
    duration_ms: int,
    exception: Exception | None = None,
    parse_error: str | None = None,
    expected_student: dict[str, str] | None = None,
) -> NormalizedAttendance:
    safe = sanitize_response(data)
    student = _student_info(safe, member_id)
    message = str((safe or {}).get("message") or "")[:500]
    attendance_status = str((safe or {}).get("attendance_status") or "") or None
    scanned_at_iso = str((safe or {}).get("scanned_at_iso") or "") or None
    is_simulation = bool((safe or {}).get("is_simulation") is True)
    success = (safe or {}).get("success")
    folded_message = _fold(message)
    folded_attendance = _fold(attendance_status)

    status = "unknown"
    reason: str | None = None
    verified_present = False

    if exception:
        reason = "Không nhận được kết quả có thể xác minh từ máy chủ. Không tự động thử lại."
        message = "Kết nối đến máy chủ không hoàn tất." if not message else message
    elif parse_error:
        reason = parse_error
        message = message or "Phản hồi máy chủ không thể xác minh."
    elif http_status in {301, 302, 303, 307, 308, 401, 403, 419}:
        status = "failed"
        message = message or "Phiên đăng nhập trường không hợp lệ hoặc đã hết hạn."
        reason = "Cần cập nhật phiên xác thực trước khi quét lại."
    elif http_status is None:
        reason = "Không có HTTP status để xác minh kết quả."
    elif http_status >= 400:
        status = "failed"
        message = message or f"Máy chủ trả về HTTP {http_status}."
        reason = "Máy chủ đã trả về lỗi rõ ràng."
    elif not isinstance(safe, dict):
        reason = "Response không có JSON object hợp lệ."
        message = message or "Phản hồi máy chủ không đúng định dạng."
    else:
        already_present = (
            success is False
            and folded_attendance == "present"
            and any(marker in folded_message for marker in PRESENT_MESSAGES)
        )
        explicit_failure = success is False and any(marker in folded_message for marker in FAILURE_MESSAGES)
        contradiction = success is True and any(marker in folded_message for marker in PRESENT_MESSAGES + FAILURE_MESSAGES)

        if contradiction:
            reason = "Response có các trường nghiệp vụ mâu thuẫn."
        elif already_present:
            status = "already_present"
            verified_present = not is_simulation
        elif success is True:
            status = "success"
            verified_present = not is_simulation
        elif explicit_failure:
            status = "failed"
        else:
            reason = "Chưa có quy tắc nghiệp vụ đáng tin cậy cho response này."

    mismatch = _identity_mismatch(student, expected_student)
    if mismatch and status in {"success", "already_present"}:
        status = "unknown"
        verified_present = False
        reason = mismatch

    if is_simulation:
        verified_present = False
        reason = (reason + " " if reason else "") + "Máy chủ xác nhận đây là dữ liệu mô phỏng."

    return NormalizedAttendance(
        member_id=member_id,
        status=status,
        http_status=http_status,
        verified_present=verified_present,
        is_simulation=is_simulation,
        message=message or "Chưa có thông báo từ máy chủ.",
        attendance_status=attendance_status,
        student=student,
        requested_at=requested_at,
        response_received_at=response_received_at,
        scanned_at_iso=scanned_at_iso,
        duration_ms=max(0, duration_ms),
        reason=reason,
        sanitized_response=safe,
    )

