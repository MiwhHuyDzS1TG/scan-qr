from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.attendance import AttendanceClient
from backend.auth import PREAUTH_COOKIE, SESSION_COOKIE, LoginRateLimiter, SessionManager, verify_password
from backend.config import settings
from backend.schemas import LoginRequest, NormalizedAttendance, ScanRequest


app = FastAPI(
    title="Attendance Control Center API",
    docs_url=None if settings.app_env == "production" else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.app_env == "production" else "/api/openapi.json",
)
sessions = SessionManager(settings)
attendance = AttendanceClient(settings)
login_limiter = LoginRateLimiter(attempts=5, window_seconds=300)
scan_limiter = LoginRateLimiter(attempts=60, window_seconds=60)
request_cache: dict[str, tuple[float, NormalizedAttendance | None]] = {}
request_cache_lock = threading.Lock()


def _cookie_secure() -> bool:
    return settings.app_env == "production"


def _session_payload(request: Request) -> dict[str, Any]:
    payload = sessions.verify(request.cookies.get(SESSION_COOKIE))
    if not payload or payload.get("kind") != "session":
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập lại.")
    return payload


def _csrf_session(request: Request, payload: dict[str, Any] = Depends(_session_payload)) -> dict[str, Any]:
    supplied = request.headers.get("X-CSRF-Token", "")
    if not supplied or supplied != payload.get("csrf"):
        raise HTTPException(status_code=403, detail="CSRF token không hợp lệ.")
    return payload


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self'; "
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def safe_exception_handler(_request: Request, _exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "Lỗi nội bộ. Không có request nào được tự động gửi lại."})


@app.get("/api/auth/session")
def auth_session(request: Request, response: Response):
    payload = sessions.verify(request.cookies.get(SESSION_COOKIE))
    if payload and payload.get("kind") == "session":
        return {
            "authenticated": True,
            "username": payload.get("sub"),
            "csrf_token": payload.get("csrf"),
        }

    preauth = sessions.verify(request.cookies.get(PREAUTH_COOKIE))
    if not preauth or preauth.get("kind") != "preauth":
        token, csrf = sessions.new_preauth()
        response.set_cookie(
            PREAUTH_COOKIE,
            token,
            httponly=True,
            secure=_cookie_secure(),
            samesite="strict",
            max_age=900,
            path="/",
        )
    else:
        csrf = str(preauth["csrf"])
    return {
        "authenticated": False,
        "csrf_token": csrf,
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.post("/api/auth/login")
def login(body: LoginRequest, request: Request, response: Response):
    client_key = request.client.host if request.client else "unknown"
    if not login_limiter.allow(client_key):
        raise HTTPException(status_code=429, detail="Đăng nhập bị tạm giới hạn. Vui lòng chờ 5 phút.")
    preauth = sessions.verify(request.cookies.get(PREAUTH_COOKIE))
    supplied_csrf = request.headers.get("X-CSRF-Token", "")
    if not preauth or preauth.get("kind") != "preauth" or supplied_csrf != preauth.get("csrf"):
        raise HTTPException(status_code=403, detail="Phiên đăng nhập không hợp lệ. Hãy tải lại trang.")
    if body.username != settings.admin_username or not verify_password(body.password, sessions.password_hash):
        raise HTTPException(status_code=401, detail="Tài khoản hoặc mật khẩu không đúng.")

    login_limiter.clear(client_key)
    token, csrf = sessions.new_session(body.username)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        max_age=settings.session_ttl_seconds,
        path="/",
    )
    response.delete_cookie(PREAUTH_COOKIE, path="/")
    return {"authenticated": True, "username": body.username, "csrf_token": csrf}


@app.post("/api/auth/logout")
def logout(response: Response, _payload: dict[str, Any] = Depends(_csrf_session)):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/members")
def members(_payload: dict[str, Any] = Depends(_session_payload)):
    return {
        "members": [
            {
                "id": member_id,
                "alias": member_id,
                "display_name": settings.member_metadata.get(member_id, {}).get("display_name"),
                "class_name": settings.member_metadata.get(member_id, {}).get("class_name"),
                "student_number": settings.member_metadata.get(member_id, {}).get("student_number"),
                "role": settings.member_metadata.get(member_id, {}).get("role"),
            }
            for member_id in settings.members
        ]
    }


@app.get("/api/health")
def health(probe: bool = Query(default=False), _payload: dict[str, Any] = Depends(_session_payload)):
    configuration = {
        "environment": settings.app_env,
        "members_loaded": len(settings.members),
        "upstream_configured": not settings.missing_upstream_configuration,
    }
    if probe:
        upstream = attendance.check_connection()
    elif settings.missing_upstream_configuration:
        upstream = {"status": "missing_configuration", "checked": False}
    else:
        upstream = {"status": "checking_required", "checked": False}
    return {"service": "ready", "configuration": configuration, "upstream": upstream}


@app.post("/api/scan", response_model=NormalizedAttendance)
def scan(body: ScanRequest, request: Request, payload: dict[str, Any] = Depends(_csrf_session)):
    if body.member_id not in settings.members:
        raise HTTPException(status_code=404, detail="Không tìm thấy thành viên.")
    if settings.missing_upstream_configuration:
        raise HTTPException(status_code=503, detail="Thiếu cấu hình phiên trường. Không gửi request điểm danh.")
    limiter_key = f"{payload.get('sub')}:{request.client.host if request.client else 'unknown'}"
    if not scan_limiter.allow(limiter_key):
        raise HTTPException(status_code=429, detail="Đã vượt giới hạn quét tạm thời.")

    now = time.monotonic()
    with request_cache_lock:
        for key in [key for key, (created, _) in request_cache.items() if now - created > 600]:
            request_cache.pop(key, None)
        existing = request_cache.get(body.request_id)
        if existing:
            if existing[1] is None:
                raise HTTPException(status_code=409, detail="Request này đang được xử lý.")
            return existing[1]
        request_cache[body.request_id] = (now, None)

    try:
        result = attendance.scan(
            body.member_id,
            settings.members[body.member_id],
            settings.member_metadata.get(body.member_id),
        )
        result.batch_id = body.batch_id
        result.request_id = body.request_id
        with request_cache_lock:
            request_cache[body.request_id] = (time.monotonic(), result)
        return result
    except Exception:
        with request_cache_lock:
            request_cache.pop(body.request_id, None)
        raise


@app.get("/api/avatar")
def avatar(path: str = Query(min_length=20, max_length=400), _payload: dict[str, Any] = Depends(_session_payload)):
    try:
        content, content_type = attendance.fetch_avatar(path)
    except Exception:
        raise HTTPException(status_code=404, detail="Không thể tải avatar.")
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "private, max-age=300"})


if not os.getenv("VERCEL") and Path("public").exists():
    app.mount("/", StaticFiles(directory="public", html=True), name="public")

