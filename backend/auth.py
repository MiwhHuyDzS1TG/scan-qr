from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

from backend.config import ConfigurationError, Settings
from backend.passwords import hash_password, verify_password


SESSION_COOKIE = "acc_session"
PREAUTH_COOKIE = "acc_preauth"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(slots=True)
class SessionManager:
    settings: Settings

    def __post_init__(self) -> None:
        if self.settings.app_env == "production" and verify_password("demo", self.settings.admin_password_hash):
            raise ConfigurationError("Production không cho phép sử dụng mật khẩu demo.")

    @property
    def secret(self) -> bytes:
        return self.settings.session_secret.encode("utf-8")

    @property
    def password_hash(self) -> str:
        return self.settings.admin_password_hash

    def sign(self, payload: dict[str, Any]) -> str:
        body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = _b64(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest())
        return f"{body}.{signature}"

    def verify(self, token: str | None) -> dict[str, Any] | None:
        if not token or "." not in token:
            return None
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(self.secret, body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            payload = json.loads(_unb64(body))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict) or int(payload.get("exp", 0)) <= int(time.time()):
            return None
        return payload

    def new_preauth(self) -> tuple[str, str]:
        csrf = secrets.token_urlsafe(32)
        token = self.sign({"csrf": csrf, "exp": int(time.time()) + 900, "kind": "preauth"})
        return token, csrf

    def new_session(self, username: str) -> tuple[str, str]:
        csrf = secrets.token_urlsafe(32)
        token = self.sign(
            {
                "sub": username,
                "csrf": csrf,
                "exp": int(time.time()) + self.settings.session_ttl_seconds,
                "kind": "session",
            }
        )
        return token, csrf


class LoginRateLimiter:
    """Small per-instance limiter. Production WAF/shared storage should enforce a global limit."""

    def __init__(self, attempts: int = 5, window_seconds: int = 300) -> None:
        self.attempts = attempts
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        queue = self._events[key]
        while queue and now - queue[0] > self.window_seconds:
            queue.popleft()
        if len(queue) >= self.attempts:
            return False
        queue.append(now)
        return True

    def clear(self, key: str) -> None:
        self._events.pop(key, None)

