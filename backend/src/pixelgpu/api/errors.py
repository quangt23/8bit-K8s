"""One error shape for every API failure:

{"error": {"code": "...", "message": "...", "details": [...]}}
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from pixelgpu.tasks.lifecycle import InvalidTransitionError
from pixelgpu.tasks.service import TaskNotFoundError, TooManyActiveTasksError
from pixelgpu.tasks.workloads import SUPPORTED_WORKLOAD_TYPES


class ErrorDetail(BaseModel):
    field: str | None = None
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(BaseModel):
    error: ErrorBody


def error_response(
    status_code: int, code: str, message: str, details: list[ErrorDetail] | None = None
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details or []))
    return JSONResponse(status_code=status_code, content=body.model_dump())


_HTTP_CODES = {
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
}


def _field(loc: tuple[Any, ...]) -> str:
    # Drop the leading "body"/"query" and pydantic's union-member tags (e.g. "echo").
    parts = (
        [str(p) for p in loc[1:]]
        if loc and loc[0] in {"body", "query", "path"}
        else list(map(str, loc))
    )
    return ".".join(p for p in parts if p not in SUPPORTED_WORKLOAD_TYPES)


def _validation_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    details: list[ErrorDetail] = []
    for err in exc.errors():
        loc = tuple(err.get("loc", ()))
        if err.get("type") == "union_tag_invalid":
            tag = err.get("ctx", {}).get("tag")
            supported = ", ".join(SUPPORTED_WORKLOAD_TYPES)
            return error_response(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "unsupported_workload",
                f"Workload type '{tag}' is not supported. Supported types: {supported}.",
                [ErrorDetail(field="workload.type", message=f"Must be one of: {supported}.")],
            )
        details.append(ErrorDetail(field=_field(loc) or None, message=str(err.get("msg"))))
    return error_response(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "validation_error",
        "The request is invalid. See details.",
        details,
    )


def _http_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    return error_response(exc.status_code, code, str(exc.detail))


def _not_found_handler(_: Request, exc: Exception) -> JSONResponse:
    return error_response(status.HTTP_404_NOT_FOUND, "not_found", str(exc))


def _transition_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, InvalidTransitionError)
    if exc.target == "cancelled":
        message = f"Task is already {exc.current} and cannot be cancelled."
    else:
        message = str(exc)
    return error_response(status.HTTP_409_CONFLICT, "invalid_transition", message)


def _too_many_handler(_: Request, exc: Exception) -> JSONResponse:
    return error_response(status.HTTP_429_TOO_MANY_REQUESTS, "too_many_active_tasks", str(exc))


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_handler)
    app.add_exception_handler(TaskNotFoundError, _not_found_handler)
    app.add_exception_handler(InvalidTransitionError, _transition_handler)
    app.add_exception_handler(TooManyActiveTasksError, _too_many_handler)
