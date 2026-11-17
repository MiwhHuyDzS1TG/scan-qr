from __future__ import annotations

import time
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from backend.config import Settings
from backend.normalization import normalize_attendance_response
from backend.schemas import NormalizedAttendance


TZ = ZoneInfo("Asia/Ho_Chi_Minh")


class UpstreamAuthenticationError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="milliseconds")


class AttendanceClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.page_url = urljoin(settings.base_url + "/", "diem-danh")
        self.attendance_url = urljoin(settings.base_url + "/", "diem-danh/quet-qr")

    def _session(self) -> requests.Session:
        session = requests.Session()
        for name, (value, domain) in self.settings.cookie_values.items():
            if value:
                session.cookies.set(name, value, domain=domain, path="/")
        session.headers.update({"User-Agent": "AttendanceControlCenter/1.0", "Accept": "application/json"})
        return session

    @staticmethod
    def _csrf_from_html(html: str) -> str | None:
        soup = BeautifulSoup(html, "html.parser")
        meta = soup.select_one('meta[name="csrf-token"]')
        if meta and meta.get("content"):
            return str(meta["content"])
        field = soup.select_one('input[name="_token"]')
        if field and field.get("value"):
            return str(field["value"])
        return None

    def _get_csrf(self, session: requests.Session) -> str:
        response = session.get(self.page_url, headers={"Accept": "text/html"}, timeout=20, allow_redirects=False)
        if response.status_code in {301, 302, 303, 307, 308, 401, 403, 419}:
            raise UpstreamAuthenticationError("Phiên trường không hợp lệ hoặc đã hết hạn.")
        response.raise_for_status()
        token = self._csrf_from_html(response.text)
        if not token:
            raise UpstreamAuthenticationError("Không tìm thấy CSRF token. Phiên trường có thể đã hết hạn.")
        return token

    def check_connection(self) -> dict[str, Any]:
        missing = self.settings.missing_upstream_configuration
        if missing:
            return {"status": "missing_configuration", "checked": False, "missing": missing}
        session = self._session()
        started = time.perf_counter()
        try:
            self._get_csrf(session)
            return {
                "status": "ready",
                "checked": True,
                "latency_ms": round((time.perf_counter() - started) * 1000),
            }
        except UpstreamAuthenticationError:
            return {"status": "session_expired", "checked": True}
        except requests.RequestException:
            return {"status": "unreachable", "checked": True}
        finally:
            session.close()

    def scan(self, member_id: str, qr_data: str, expected_student: dict[str, str] | None = None) -> NormalizedAttendance:
        requested_at = now_iso()
        started = time.perf_counter()
        session = self._session()
        response_received_at = requested_at
        try:
            csrf_token = self._get_csrf(session)
            payload = {
                "qr_data": qr_data,
                "force_status": "auto",
                "device_id": "web_camera_qr",
                "scanned_at": datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"),
            }
            response = session.post(
                self.attendance_url,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-CSRF-TOKEN": csrf_token,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": self.page_url,
                },
                timeout=30,
                allow_redirects=False,
            )
            response_received_at = now_iso()
            duration_ms = round((time.perf_counter() - started) * 1000)
            if not response.content:
                return normalize_attendance_response(
                    member_id=member_id,
                    http_status=response.status_code,
                    data=None,
                    requested_at=requested_at,
                    response_received_at=response_received_at,
                    duration_ms=duration_ms,
                    parse_error="Máy chủ trả về body rỗng.",
                    expected_student=expected_student,
                )
            try:
                data = response.json()
                parse_error = None
            except ValueError:
                data = None
                parse_error = "Máy chủ trả về JSON không hợp lệ."
            return normalize_attendance_response(
                member_id=member_id,
                http_status=response.status_code,
                data=data,
                requested_at=requested_at,
                response_received_at=response_received_at,
                duration_ms=duration_ms,
                parse_error=parse_error,
                expected_student=expected_student,
            )
        except (requests.Timeout, requests.ConnectionError, requests.RequestException) as exc:
            response_received_at = now_iso()
            return normalize_attendance_response(
                member_id=member_id,
                http_status=None,
                data=None,
                requested_at=requested_at,
                response_received_at=response_received_at,
                duration_ms=round((time.perf_counter() - started) * 1000),
                exception=exc,
                expected_student=expected_student,
            )
        except UpstreamAuthenticationError as exc:
            response_received_at = now_iso()
            return normalize_attendance_response(
                member_id=member_id,
                http_status=419,
                data={"message": str(exc)},
                requested_at=requested_at,
                response_received_at=response_received_at,
                duration_ms=round((time.perf_counter() - started) * 1000),
                expected_student=expected_student,
            )
        finally:
            session.close()

    def fetch_avatar(self, path: str) -> tuple[bytes, str]:
        parsed = urlparse(path)
        if (
            parsed.scheme
            or parsed.netloc
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith("/storage/avatars/")
            or ".." in parsed.path
        ):
            raise ValueError("Đường dẫn avatar không hợp lệ.")
        session = self._session()
        try:
            response = session.get(urljoin(self.settings.base_url, parsed.path), timeout=12, allow_redirects=False)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if not content_type.startswith("image/") or len(response.content) > 5_000_000:
                raise ValueError("Dữ liệu avatar không hợp lệ.")
            return response.content, content_type.split(";", 1)[0]
        finally:
            session.close()

