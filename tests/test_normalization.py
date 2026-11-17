import json
from pathlib import Path

from backend.normalization import normalize_attendance_response


FIXTURE = json.loads(Path("tests/fixtures/already_present.json").read_text(encoding="utf-8"))
TIMING = {
    "requested_at": "2026-11-17T14:54:40+07:00",
    "response_received_at": "2026-11-17T14:54:41+07:00",
    "duration_ms": 467,
}


def normalize(data=FIXTURE, **kwargs):
    return normalize_attendance_response(member_id="MinhHuy", http_status=200, data=data, **TIMING, **kwargs)


def test_observed_response_is_already_present_not_failure():
    result = normalize()
    assert result.status == "already_present"
    assert result.status != "failed"
    assert result.status != "success"
    assert result.verified_present is True


def test_explicit_success_is_success():
    result = normalize(data={"success": True, "attendance_status": "present", "message": "Điểm danh thành công."})
    assert result.status == "success"
    assert result.verified_present is True


def test_explicit_business_failure_is_failed():
    result = normalize(data={"success": False, "attendance_status": "absent", "message": "Mã QR không hợp lệ."})
    assert result.status == "failed"
    assert result.verified_present is False


def test_server_timestamp_is_preserved():
    assert normalize().scanned_at_iso == "2026-11-17T13:59:41+07:00"


def test_timeout_is_unknown_and_never_guessed_successful():
    result = normalize_attendance_response(
        member_id="MinhHuy",
        http_status=None,
        data=None,
        exception=TimeoutError(),
        **TIMING,
    )
    assert result.status == "unknown"
    assert result.verified_present is False
    assert "Không tự động thử lại" in result.reason


def test_invalid_json_is_unknown():
    result = normalize(data=None, parse_error="Máy chủ trả về JSON không hợp lệ.")
    assert result.status == "unknown"


def test_success_with_contradictory_message_is_unknown():
    result = normalize(data={"success": True, "attendance_status": "present", "message": "Đã điểm danh rồi!"})
    assert result.status == "unknown"
    assert "mâu thuẫn" in result.reason


def test_server_simulation_is_not_verified_real_attendance():
    data = {**FIXTURE, "is_simulation": True}
    result = normalize(data=data)
    assert result.status == "already_present"
    assert result.is_simulation is True
    assert result.verified_present is False


def test_mismatched_student_becomes_unknown():
    result = normalize(expected_student={"display_name": "Nguyễn Văn Khác"})
    assert result.status == "unknown"
    assert result.verified_present is False
    assert "không khớp" in result.reason


def test_untrusted_avatar_is_removed():
    data = json.loads(json.dumps(FIXTURE))
    data["student"]["avatar"] = "https://evil.example/avatar.jpg"
    result = normalize(data=data)
    assert result.student.avatar is None
    assert result.student.avatar_url is None

