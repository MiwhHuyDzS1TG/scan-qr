from fastapi.testclient import TestClient

import main
from backend.normalization import normalize_attendance_response


TEST_USERNAME = "test-admin"
TEST_PASSWORD = "test-password-not-for-production"
EXPECTED_ALIASES = {"MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan"}


def authenticated_client():
    client = TestClient(main.app)
    session = client.get("/api/auth/session").json()
    login = client.post(
        "/api/auth/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
        headers={"X-CSRF-Token": session["csrf_token"]},
    )
    assert login.status_code == 200
    return client, login.json()["csrf_token"]


def test_members_api_never_exposes_qr_values():
    client, _ = authenticated_client()
    response = client.get("/api/members")
    assert response.status_code == 200
    body = response.text
    assert "qr_data" not in body
    assert {item["alias"] for item in response.json()["members"]} == EXPECTED_ALIASES
    assert len(response.json()["members"]) == 6
    for qr_value in main.settings.members.values():
        assert qr_value not in body


def test_unknown_member_is_rejected():
    client, csrf = authenticated_client()
    response = client.post(
        "/api/scan",
        json={"member_id": "DoesNotExist", "batch_id": "batch_12345678", "request_id": "request_12345678"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 404


def _mock_result(member_id: str):
    return normalize_attendance_response(
        member_id=member_id,
        http_status=200,
        data={"success": True, "is_simulation": False, "message": "Điểm danh thành công.", "attendance_status": "present"},
        requested_at="2026-11-17T14:00:00+07:00",
        response_received_at="2026-11-17T14:00:01+07:00",
        duration_ms=100,
    )


def test_scan_calls_mocked_upstream_once(monkeypatch):
    client, csrf = authenticated_client()
    calls = []
    monkeypatch.setattr(main.attendance, "scan", lambda member_id, *_args, **_kwargs: calls.append(member_id) or _mock_result(member_id))
    member_id = next(iter(main.settings.members))
    response = client.post(
        "/api/scan",
        json={"member_id": member_id, "batch_id": "batch_real1234", "request_id": "request_real1234"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert "is_demo" not in response.json()
    assert calls == [member_id]


def test_duplicate_request_id_returns_same_result(monkeypatch):
    client, csrf = authenticated_client()
    member_id = next(iter(main.settings.members))
    calls = []
    monkeypatch.setattr(main.attendance, "scan", lambda current, *_args, **_kwargs: calls.append(current) or _mock_result(current))
    payload = {"member_id": member_id, "batch_id": "batch_same1234", "request_id": "request_same1234"}
    first = client.post("/api/scan", json=payload, headers={"X-CSRF-Token": csrf})
    second = client.post("/api/scan", json=payload, headers={"X-CSRF-Token": csrf})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert calls == [member_id]


def test_scan_requires_authentication():
    response = TestClient(main.app).post(
        "/api/scan",
        json={"member_id": "MinhHuy", "batch_id": "batch_auth1234", "request_id": "request_auth1234"},
    )
    assert response.status_code == 401


def test_demo_credentials_are_not_available():
    client = TestClient(main.app)
    session = client.get("/api/auth/session").json()
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "demo"},
        headers={"X-CSRF-Token": session["csrf_token"]},
    )
    assert response.status_code == 401
    assert "demo_hint" not in session


def test_health_without_probe_does_not_contact_upstream(monkeypatch):
    client, _ = authenticated_client()
    monkeypatch.setattr(main.attendance, "check_connection", lambda: (_ for _ in ()).throw(AssertionError("upstream called")))
    response = client.get("/api/health?probe=false")
    assert response.status_code == 200
    assert response.json()["upstream"]["status"] == "checking_required"

