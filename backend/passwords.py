from __future__ import annotations

import base64
import hashlib
import hmac
import secrets


def hash_password(password: str, *, salt: bytes | None = None, n: int = 2**14) -> str:
    actual_salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=actual_salt, n=n, r=8, p=1, dklen=32)
    return "scrypt${}${}${}${}".format(
        n,
        base64.urlsafe_b64encode(actual_salt).decode().rstrip("="),
        8,
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n_value, salt_value, r_value, digest_value = encoded.split("$", 4)
        if scheme != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_value + "=" * (-len(salt_value) % 4))
        expected = base64.urlsafe_b64decode(digest_value + "=" * (-len(digest_value) % 4))
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n_value), r=int(r_value), p=1, dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
