import base64
import hashlib
import json
import os


TEST_USERNAME = "test-admin"
TEST_PASSWORD = "test-password-not-for-production"


def _test_password_hash(password: str) -> str:
    salt = b"acc-test-salt-v1"
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt${}${}${}${}".format(
        2**14,
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        8,
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


TEST_MEMBERS = {
    "MinhHuy": "TEST_QR_001",
    "HoangPhong": "TEST_QR_002",
    "GiaLam": "TEST_QR_003",
    "MinhKhang": "TEST_QR_004",
    "NgocDuc": "TEST_QR_005",
    "KimNgan": "TEST_QR_006",
}

os.environ.update(
    {
        "APP_ENV": "test",
        "ADMIN_USERNAME": TEST_USERNAME,
        "ADMIN_PASSWORD_HASH": _test_password_hash(TEST_PASSWORD),
        "SESSION_SECRET": "test-session-secret-not-for-production-123456789",
        "QR_DATA_JSON": json.dumps(TEST_MEMBERS),
        "MEMBER_METADATA_JSON": "{}",
        "CF_CLEARANCE": "test-cookie",
        "LARAVEL_SESSION": "test-cookie",
        "REMEMBER_WEB": "test-cookie",
        "XSRF_TOKEN": "test-cookie",
    }
)
