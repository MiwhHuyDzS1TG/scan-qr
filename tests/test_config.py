import pytest

from backend.auth import SessionManager, hash_password
from backend.config import ConfigurationError, REQUIRED_MEMBER_IDS, Settings


def member_mapping():
    return {member_id: f"TEST_QR_{index:03d}" for index, member_id in enumerate(REQUIRED_MEMBER_IDS, 1)}


def production_settings(password: str = "strong-password-not-for-production"):
    return Settings(
        app_env="production",
        members=member_mapping(),
        member_metadata={},
        admin_username="attendance-admin",
        admin_password_hash=hash_password(password, salt=b"config-test-salt"),
        session_secret="production-test-secret-with-more-than-32-characters",
        cf_clearance="test",
        laravel_session="test",
        remember_web="test",
        xsrf_token="test",
    )


def test_required_aliases_are_exactly_six():
    assert set(member_mapping()) == {"MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan"}


def test_settings_rejects_missing_or_extra_aliases():
    members = member_mapping()
    members.pop("KimNgan")
    with pytest.raises(ConfigurationError, match="chính xác 6"):
        Settings(
            app_env="test",
            members=members,
            member_metadata={},
            admin_username="test-admin",
            admin_password_hash=hash_password("strong-password", salt=b"config-test-salt"),
            session_secret="test-session-secret-with-more-than-32-characters",
        )


def test_production_rejects_demo_password():
    with pytest.raises(ConfigurationError, match="mật khẩu demo"):
        SessionManager(production_settings(password="demo"))


def test_production_rejects_missing_upstream_configuration():
    with pytest.raises(ConfigurationError, match="thiếu cấu hình upstream"):
        Settings(
            app_env="production",
            members=member_mapping(),
            member_metadata={},
            admin_username="attendance-admin",
            admin_password_hash=hash_password("strong-password", salt=b"config-test-salt"),
            session_secret="production-test-secret-with-more-than-32-characters",
            cf_clearance=None,
            laravel_session=None,
            remember_web=None,
            xsrf_token=None,
        )
