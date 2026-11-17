import pytest

from backend.auth import SessionManager, hash_password
from backend.config import ConfigurationError, Settings, _json_object, _validate_members


MEMBER_IDS = ("MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan", "Ram")


def member_mapping():
    return {member_id: f"TEST_QR_{index:03d}" for index, member_id in enumerate(MEMBER_IDS, 1)}


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


def test_settings_accepts_ram_and_future_members():
    members = member_mapping()
    members["FutureMember"] = "TEST_QR_008"
    settings = Settings(
        app_env="test",
        members=members,
        member_metadata={},
        admin_username="test-admin",
        admin_password_hash=hash_password("strong-password", salt=b"config-test-salt"),
        session_secret="test-session-secret-with-more-than-32-characters",
    )
    assert list(settings.members) == [*MEMBER_IDS, "FutureMember"]


def test_member_validation_rejects_empty_qr_and_duplicate_qr():
    with pytest.raises(ConfigurationError, match="ít nhất một"):
        _validate_members({})
    with pytest.raises(ConfigurationError, match="không hợp lệ"):
        _validate_members({"Ram": "   "})
    with pytest.raises(ConfigurationError, match="QR data trùng"):
        _validate_members({"Ram": "same", "Another": "same"})


def test_json_parser_rejects_duplicate_alias_keys():
    with pytest.raises(ConfigurationError, match="khóa trùng"):
        _json_object('{"Ram":"first","Ram":"second"}', "QR_DATA_JSON")


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
