from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


NormalizedStatus = Literal["idle", "scanning", "success", "already_present", "failed", "unknown"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=512)


class ScanRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    batch_id: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class StudentInfo(BaseModel):
    name: str | None = None
    class_name: str | None = None
    student_number: str | None = None
    role: str | None = None
    avatar: str | None = None
    avatar_url: str | None = None

    @field_validator("name", "class_name", "student_number", "role", "avatar", mode="before")
    @classmethod
    def stringify_safe_values(cls, value: Any) -> str | None:
        if value is None:
            return None
        return str(value)[:500]


class NormalizedAttendance(BaseModel):
    member_id: str
    status: NormalizedStatus
    http_status: int | None = None
    verified_present: bool = False
    is_simulation: bool = False
    message: str
    attendance_status: str | None = None
    student: StudentInfo | None = None
    requested_at: str
    response_received_at: str
    scanned_at_iso: str | None = None
    duration_ms: int
    reason: str | None = None
    batch_id: str | None = None
    request_id: str | None = None
    sanitized_response: dict[str, Any] | None = None

