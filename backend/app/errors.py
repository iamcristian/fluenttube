import uuid
from typing import Any, Dict, Optional
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

class AppException(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        retryable: bool = False,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        self.details = details or {}

def format_error_response(
    code: str,
    message: str,
    status_code: int,
    retryable: bool = False,
    details: Optional[Dict[str, Any]] = None,
    request_id: Optional[str] = None,
) -> JSONResponse:
    req_id = request_id or str(uuid.uuid4())
    payload = {
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
            "request_id": req_id,
        }
    }
    return JSONResponse(status_code=status_code, content=payload)

async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    return format_error_response(
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        retryable=exc.retryable,
        details=exc.details,
        request_id=request_id,
    )

async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    # Default code from status
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "RESOURCE_NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        410: "RESOURCE_EXPIRED",
        413: "PAYLOAD_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    code = code_map.get(exc.status_code, "HTTP_ERROR")
    return format_error_response(
        code=code,
        message=str(exc.detail),
        status_code=exc.status_code,
        retryable=exc.status_code in (429, 502, 503),
        details={},
        request_id=request_id,
    )

async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    # Format details safely without absolute paths
    clean_errors = []
    for err in exc.errors():
        clean_errors.append({
            "loc": [str(loc) for loc in err.get("loc", [])],
            "msg": err.get("msg", ""),
            "type": err.get("type", ""),
        })

    return format_error_response(
        code="INVALID_INPUT",
        message="Request validation failed.",
        status_code=422,
        retryable=False,
        details={"errors": clean_errors},
        request_id=request_id,
    )

async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    # Never leak stack traces or internal details
    return format_error_response(
        code="INTERNAL_ERROR",
        message="An unexpected server error occurred.",
        status_code=500,
        retryable=False,
        details={},
        request_id=request_id,
    )
