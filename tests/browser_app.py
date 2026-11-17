import base64
import hashlib
import json
import os


def _password_hash(password: str) -> str:
    salt = b"acc-browser-test"
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt${}${}${}${}".format(
        2**14,
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        8,
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


os.environ.update(
    {
        "APP_ENV": "test",
        "ADMIN_USERNAME": "test-admin",
        "ADMIN_PASSWORD_HASH": _password_hash("test-password-not-for-production"),
        "SESSION_SECRET": "browser-test-session-secret-not-for-production",
        "QR_DATA_JSON": json.dumps(
            {
                "MinhHuy": "BROWSER_QR_001",
                "HoangPhong": "BROWSER_QR_002",
                "GiaLam": "BROWSER_QR_003",
                "MinhKhang": "BROWSER_QR_004",
                "NgocDuc": "BROWSER_QR_005",
                "KimNgan": "BROWSER_QR_006",
                "Ram": "BROWSER_QR_007",
            }
        ),
        "MEMBER_METADATA_JSON": "{}",
        "CF_CLEARANCE": "test-cookie",
        "LARAVEL_SESSION": "test-cookie",
        "REMEMBER_WEB": "test-cookie",
        "XSRF_TOKEN": "test-cookie",
    }
)

from backend.normalization import normalize_attendance_response

import main


def mocked_scan(member_id: str, _qr_data: str, _expected_student=None):
    already_present = member_id in {"MinhHuy", "NgocDuc"}
    data = {
        "success": not already_present,
        "is_simulation": False,
        "message": "Đã điểm danh rồi!" if already_present else "Điểm danh thành công.",
        "scanned_at_iso": "2026-11-17T13:59:41+07:00",
        "attendance_status": "present",
        "student": {"name": member_id, "class_name": "12 TIN", "student_number": "01", "role": "student"},
    }
    return normalize_attendance_response(
        member_id=member_id,
        http_status=200,
        data=data,
        requested_at="2026-11-17T13:59:40+07:00",
        response_received_at="2026-11-17T13:59:41+07:00",
        duration_ms=20,
    )


main.attendance.scan = mocked_scan
app = main.app
