import json
import os
import subprocess
import sys

from backend.auth import hash_password


MEMBER_IDS = ("MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan", "Ram")


def test_production_app_imports_without_network_or_real_secrets():
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "ADMIN_USERNAME": "production-test-admin",
            "ADMIN_PASSWORD_HASH": hash_password("production-test-password", salt=b"startup-test-salt"),
            "SESSION_SECRET": "production-startup-test-secret-more-than-32-characters",
            "QR_DATA_JSON": json.dumps(
                {member_id: f"STARTUP_TEST_QR_{index:03d}" for index, member_id in enumerate(MEMBER_IDS, 1)}
            ),
            "MEMBER_METADATA_JSON": "{}",
            "CF_CLEARANCE": "test-cookie",
            "LARAVEL_SESSION": "test-cookie",
            "REMEMBER_WEB": "test-cookie",
            "XSRF_TOKEN": "test-cookie",
            "VERCEL": "1",
        }
    )
    completed = subprocess.run(
        [sys.executable, "-c", "from main import app; assert app.title == 'Attendance Control Center API'"],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
