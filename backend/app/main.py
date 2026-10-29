import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from backend.app.config import settings
from backend.app.database import init_db
from backend.app.errors import (
    AppException,
    app_exception_handler,
    format_error_response,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from backend.app.routers.health import router as health_router
from backend.app.routers.jobs import router as jobs_router
from backend.app.routers.videos import router as videos_router
from backend.app.routers.local_videos import router as local_videos_router
from backend.app.routers.dictation import router as dictation_router
from backend.app.routers.shadowing import router as shadowing_router
from backend.app.routers.tutor import router as tutor_router
from backend.app.routers.british import router as british_router
from backend.app.routers.vocabulary import router as vocabulary_router
from backend.app.services.jobs import job_runner
from backend.app.services.youtube_service import handle_ingest_job
from backend.app.services.local_video import handle_local_ingest_job
from backend.app.services.shadowing_service import handle_shadowing_job

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "testserver"}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables & register job handlers & recover interrupted jobs & start worker thread
    init_db()
    job_runner.register_handler("ingest", handle_ingest_job)
    job_runner.register_handler("local_ingest", handle_local_ingest_job)
    job_runner.register_handler("shadowing", handle_shadowing_job)
    job_runner.start()
    yield
    # Graceful shutdown of worker thread
    job_runner.stop()

app = FastAPI(
    title="FluentTube AI Backend",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# 1. Request ID tracking & Security (Host & Origin validation)
@app.middleware("http")
async def security_and_tracking_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id

    # Validate Host header
    host_header = request.headers.get("host")
    if host_header:
        hostname = host_header.split(":")[0].strip()
        if hostname not in ALLOWED_HOSTS:
            return format_error_response(
                code="INVALID_HOST",
                message="Host header rejected. Only localhost/127.0.0.1 is permitted.",
                status_code=400,
                retryable=False,
                details={"host": host_header},
                request_id=request_id,
            )

    # Validate Origin on mutating requests (Section 5.1)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin_header = request.headers.get("origin")
        if origin_header and origin_header not in settings.ALLOWED_ORIGINS:
            return format_error_response(
                code="UNAUTHORIZED_ORIGIN",
                message="Mutating request from unauthorized origin rejected.",
                status_code=403,
                retryable=False,
                details={"origin": origin_header},
                request_id=request_id,
            )

    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

# Strict CORS: allowed origins strictly from settings (no wildcard *)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Exception handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

# Include routers
app.include_router(health_router, prefix="/api")
app.include_router(health_router)
app.include_router(jobs_router, prefix="/api")
app.include_router(jobs_router)
app.include_router(videos_router, prefix="/api")
app.include_router(videos_router)
app.include_router(local_videos_router, prefix="/api")
app.include_router(dictation_router, prefix="/api")
app.include_router(dictation_router)
app.include_router(shadowing_router, prefix="/api")
app.include_router(shadowing_router)
app.include_router(tutor_router, prefix="/api")
app.include_router(tutor_router)
app.include_router(vocabulary_router, prefix="/api")
app.include_router(vocabulary_router)
app.include_router(british_router)

