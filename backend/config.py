from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MEMBER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DEFAULT_BASE_URL = "https://chuyencan.chuyenthanglongdalat.edu.vn"
REQUIRED_MEMBER_IDS = ("MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan")


class ConfigurationError(RuntimeError):
    """Raised when a security-sensitive configuration value is invalid."""


def _json_object(raw: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigurationError(f"{label} không phải JSON hợp lệ.") from exc
    if not isinstance(value, dict):
        raise ConfigurationError(f"{label} phải là một JSON object.")
    return value


def _load_members() -> dict[str, str]:
    raw = os.getenv("QR_DATA_JSON")
    if raw:
        source = _json_object(raw, "QR_DATA_JSON")
    else:
        path = Path(os.getenv("QR_DATA_FILE", "qr_data.json"))
        if not path.exists():
            return {}
        source = _json_object(path.read_text(encoding="utf-8-sig"), str(path))

    members: dict[str, str] = {}
    qr_values: set[str] = set()
    for member_id, qr_data in source.items():
        if not isinstance(member_id, str) or not MEMBER_ID_PATTERN.fullmatch(member_id):
            raise ConfigurationError(f"Member ID không hợp lệ: {member_id!r}")
        if not isinstance(qr_data, str) or not (4 <= len(qr_data) <= 2048):
            raise ConfigurationError(f"QR data của {member_id} không hợp lệ.")
        if qr_data in qr_values:
            raise ConfigurationError("Phát hiện QR data trùng giữa các thành viên.")
        qr_values.add(qr_data)
        members[member_id] = qr_data
    expected = set(REQUIRED_MEMBER_IDS)
    actual = set(members)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        details = []
        if missing:
            details.append("thiếu alias: " + ", ".join(missing))
        if unexpected:
            details.append("alias không được quản lý: " + ", ".join(unexpected))
        raise ConfigurationError("Nguồn QR phải chứa chính xác 6 thành viên (" + "; ".join(details) + ").")
    return members


def _load_metadata() -> dict[str, dict[str, str]]:
    raw = os.getenv("MEMBER_METADATA_JSON", "{}")
    source = _json_object(raw, "MEMBER_METADATA_JSON")
    result: dict[str, dict[str, str]] = {}
    allowed = {"display_name", "class_name", "student_number", "role"}
    for member_id, value in source.items():
        if not MEMBER_ID_PATTERN.fullmatch(str(member_id)) or not isinstance(value, dict):
            raise ConfigurationError("MEMBER_METADATA_JSON có cấu trúc không hợp lệ.")
        result[str(member_id)] = {
            key: str(item)[:200]
            for key, item in value.items()
            if key in allowed and item is not None
        }
    return result


def _validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ConfigurationError("BASE_URL phải là HTTPS origin hợp lệ.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ConfigurationError("BASE_URL chỉ được chứa origin, không chứa path/query.")
    return value.rstrip("/")


@dataclass(slots=True)
class Settings:
    app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "").lower())
    base_url: str = field(default_factory=lambda: _validate_base_url(os.getenv("BASE_URL", DEFAULT_BASE_URL)))
    members: dict[str, str] = field(default_factory=_load_members)
    member_metadata: dict[str, dict[str, str]] = field(default_factory=_load_metadata)
    admin_username: str = field(default_factory=lambda: os.getenv("ADMIN_USERNAME", ""))
    admin_password_hash: str = field(default_factory=lambda: os.getenv("ADMIN_PASSWORD_HASH", ""))
    session_secret: str = field(default_factory=lambda: os.getenv("SESSION_SECRET", ""))
    session_ttl_seconds: int = field(default_factory=lambda: int(os.getenv("SESSION_TTL_SECONDS", "28800")))
    cf_clearance: str | None = field(default_factory=lambda: os.getenv("CF_CLEARANCE"))
    laravel_session: str | None = field(default_factory=lambda: os.getenv("LARAVEL_SESSION"))
    remember_web: str | None = field(default_factory=lambda: os.getenv("REMEMBER_WEB"))
    xsrf_token: str | None = field(default_factory=lambda: os.getenv("XSRF_TOKEN"))

    def __post_init__(self) -> None:
        if self.app_env not in {"development", "production", "test"}:
            raise ConfigurationError("APP_ENV phải là development, production hoặc test.")
        expected_members = set(REQUIRED_MEMBER_IDS)
        actual_members = set(self.members)
        if actual_members != expected_members:
            raise ConfigurationError("Nguồn QR phải chứa chính xác 6 thành viên được quản lý.")
        if len(set(self.members.values())) != len(self.members):
            raise ConfigurationError("Phát hiện QR data trùng giữa các thành viên.")
        if not self.admin_username or self.admin_username.lower() in {"demo", "example"}:
            raise ConfigurationError("ADMIN_USERNAME chưa được cấu hình an toàn.")
        if not re.fullmatch(r"scrypt\$\d+\$[A-Za-z0-9_-]+\$\d+\$[A-Za-z0-9_-]+", self.admin_password_hash):
            raise ConfigurationError("ADMIN_PASSWORD_HASH phải là hash scrypt hợp lệ.")
        if len(self.session_secret) < 32 or "replace-with" in self.session_secret.lower():
            raise ConfigurationError("SESSION_SECRET phải là giá trị ngẫu nhiên tối thiểu 32 ký tự.")
        if not 900 <= self.session_ttl_seconds <= 86400:
            raise ConfigurationError("SESSION_TTL_SECONDS phải nằm trong khoảng 900 đến 86400.")
        if self.app_env == "production" and self.missing_upstream_configuration:
            raise ConfigurationError(
                "Production thiếu cấu hình upstream: " + ", ".join(self.missing_upstream_configuration) + "."
            )

    @property
    def cookie_values(self) -> dict[str, tuple[str | None, str]]:
        return {
            "cf_clearance": (self.cf_clearance, ".chuyenthanglongdalat.edu.vn"),
            "laravel_session": (self.laravel_session, "chuyencan.chuyenthanglongdalat.edu.vn"),
            "remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d": (
                self.remember_web,
                "chuyencan.chuyenthanglongdalat.edu.vn",
            ),
            "XSRF-TOKEN": (self.xsrf_token, "chuyencan.chuyenthanglongdalat.edu.vn"),
        }

    @property
    def missing_upstream_configuration(self) -> list[str]:
        mapping = {
            "CF_CLEARANCE": self.cf_clearance,
            "LARAVEL_SESSION": self.laravel_session,
            "REMEMBER_WEB": self.remember_web,
            "XSRF_TOKEN": self.xsrf_token,
        }
        return [name for name, value in mapping.items() if not value]


settings = Settings()

