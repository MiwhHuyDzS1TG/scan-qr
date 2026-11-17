import requests

from backend.attendance import AttendanceClient
from backend.auth import hash_password
from backend.config import Settings


MEMBERS = {
    "MinhHuy": "TEST_QR_001",
    "HoangPhong": "TEST_QR_002",
    "GiaLam": "TEST_QR_003",
    "MinhKhang": "TEST_QR_004",
    "NgocDuc": "TEST_QR_005",
    "KimNgan": "TEST_QR_006",
}


def settings():
    return Settings(
        app_env="test",
        members=MEMBERS,
        member_metadata={},
        admin_username="test-admin",
        admin_password_hash=hash_password("test-password", salt=b"attendance-test1"),
        session_secret="test-session-secret-not-for-production-123456789",
    )


class FakeResponse:
    status_code = 200
    text = "<html><body>no token</body></html>"

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self):
        self.post_count = 0
        self.closed = False

    def get(self, *args, **kwargs):
        return FakeResponse()

    def post(self, *args, **kwargs):
        self.post_count += 1
        raise AssertionError("POST must not run when CSRF is missing")

    def close(self):
        self.closed = True


def test_missing_csrf_does_not_send_post(monkeypatch):
    client = AttendanceClient(settings())
    session = FakeSession()
    monkeypatch.setattr(client, "_session", lambda: session)
    result = client.scan("MinhHuy", "fake-code")
    assert result.status == "failed"
    assert result.http_status == 419
    assert session.post_count == 0
    assert session.closed is True


class TokenResponse(FakeResponse):
    text = '<meta name="csrf-token" content="test-token">'


class TimeoutSession(FakeSession):
    def get(self, *args, **kwargs):
        return TokenResponse()

    def post(self, *args, **kwargs):
        self.post_count += 1
        raise requests.Timeout("mocked timeout")


def test_timeout_is_unknown_and_post_is_not_retried(monkeypatch):
    client = AttendanceClient(settings())
    session = TimeoutSession()
    monkeypatch.setattr(client, "_session", lambda: session)
    result = client.scan("MinhHuy", "TEST_QR_001")
    assert result.status == "unknown"
    assert session.post_count == 1
    assert session.closed is True

