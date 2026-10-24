"""
FluentTube AI - Environment and Hardware Diagnostics (Task T17)
Validates local Python, FFmpeg, CTranslate2, CUDA, NVIDIA GPU, and compute types.
"""

import json
import os
import shutil
import site
import subprocess
import sys
from pathlib import Path

# Ensure project root is in sys.path when invoked directly
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

def register_nvidia_dll_paths() -> list[str]:
    """Register NVIDIA wheel DLL directories on Windows for CUDA 12 and cuDNN 9."""
    registered = []
    if os.name != "nt":
        return registered

    for site_pkg in site.getsitepackages():
        nvidia_root = Path(site_pkg) / "nvidia"
        if nvidia_root.exists():
            for sub in nvidia_root.iterdir():
                for candidate in ["bin", "lib"]:
                    bin_dir = sub / candidate
                    if bin_dir.is_dir():
                        try:
                            os.add_dll_directory(str(bin_dir))
                            registered.append(str(bin_dir))
                        except Exception:
                            pass
                        current_path = os.environ.get("PATH", "")
                        if str(bin_dir) not in current_path:
                            os.environ["PATH"] = f"{str(bin_dir)};{current_path}"
    return registered

def get_gpu_diagnostics() -> dict:
    """Query NVIDIA GPU hardware details via nvidia-smi."""
    try:
        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        lines = res.stdout.strip().split("\n")
        if lines and lines[0]:
            parts = [p.strip() for p in lines[0].split(",")]
            return {
                "gpu_name": parts[0] if len(parts) > 0 else None,
                "vram_total_mb": int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None,
                "vram_free_mb": int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None,
                "driver_version": parts[3] if len(parts) > 3 else None,
            }
    except Exception as e:
        return {
            "gpu_name": None,
            "vram_total_mb": None,
            "vram_free_mb": None,
            "driver_version": None,
            "error": str(e),
        }
    return {}

def check_environment() -> dict:
    registered_dlls = register_nvidia_dll_paths()

    # 1. Python info
    py_version = sys.version.split()[0]
    py_ok = sys.version_info >= (3, 11)

    # 2. FFmpeg & ffprobe
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    ffmpeg_version = None
    if ffmpeg_path:
        try:
            out = subprocess.run([ffmpeg_path, "-version"], capture_output=True, text=True, timeout=5)
            ffmpeg_version = out.stdout.split("\n")[0]
        except Exception:
            ffmpeg_version = "available"

    # 3. CTranslate2 and CUDA
    ctranslate2_version = None
    cuda_device_count = 0
    cpu_compute_types = []
    cuda_compute_types = []
    ctranslate2_err = None

    try:
        import ctranslate2
        ctranslate2_version = getattr(ctranslate2, "__version__", "unknown")
        cuda_device_count = ctranslate2.get_cuda_device_count()
        cpu_compute_types = sorted(list(ctranslate2.get_supported_compute_types("cpu")))
        if cuda_device_count > 0:
            cuda_compute_types = sorted(list(ctranslate2.get_supported_compute_types("cuda")))
    except Exception as e:
        ctranslate2_err = str(e)

    # 4. GPU hardware diagnostics
    gpu_diag = get_gpu_diagnostics()

    # 5. Cached models
    model_cache = Path("./data/models").resolve()
    cached_models = []
    if model_cache.exists():
        for d in model_cache.iterdir():
            if d.name.startswith("models--"):
                cached_models.append(d.name.replace("models--", "").replace("--", "/"))

    # 6. Database and tutor diagnostics
    db_ok = False
    tutor_info = {"enabled": False, "provider": None, "has_key": False}
    try:
        from backend.app.config import settings
        from backend.app.database import get_engine, init_db
        from sqlalchemy import text
        engine = get_engine(settings.DATABASE_URL)
        init_db(engine)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
        tutor_info = {
            "enabled": bool(settings.TUTOR_ENABLED and settings.GEMINI_API_KEY),
            "provider": settings.TUTOR_PROVIDER,
            "has_key": bool(settings.GEMINI_API_KEY),
        }
    except Exception as e:
        tutor_info["error"] = str(e)

    report = {
        "python": {
            "version": py_version,
            "compatible": py_ok,
            "executable": sys.executable,
        },
        "database": {
            "connected": db_ok,
        },
        "ffmpeg": {
            "available": ffmpeg_path is not None,
            "path": ffmpeg_path,
            "version": ffmpeg_version,
            "ffprobe_available": ffprobe_path is not None,
        },
        "speech_runtime": {
            "ctranslate2_version": ctranslate2_version,
            "cuda_device_count": cuda_device_count,
            "cpu_compute_types": cpu_compute_types,
            "cuda_compute_types": cuda_compute_types,
            "int8_float16_supported": "int8_float16" in cuda_compute_types,
            "int8_cpu_supported": "int8" in cpu_compute_types,
            "error": ctranslate2_err,
            "registered_dll_dirs": registered_dlls,
        },
        "gpu": gpu_diag,
        "models": {
            "cache_dir": str(model_cache),
            "cached_models": cached_models,
        },
        "tutor": tutor_info,
    }

    return report

def main():
    report = check_environment()
    as_json = "--json" in sys.argv

    if as_json:
        print(json.dumps(report, indent=2))
        return

    print("=" * 60)
    print("FluentTube AI - System & Hardware Diagnostics")
    print("=" * 60)
    print(f"Python:       {report['python']['version']} ({'OK' if report['python']['compatible'] else 'INCOMPATIBLE'})")
    print(f"FFmpeg:       {'OK - ' + str(report['ffmpeg']['version']) if report['ffmpeg']['available'] else 'NOT FOUND'}")
    print(f"ffprobe:      {'OK' if report['ffmpeg']['ffprobe_available'] else 'NOT FOUND'}")
    print(f"CTranslate2:  {report['speech_runtime']['ctranslate2_version']}")
    print(f"CUDA Devices: {report['speech_runtime']['cuda_device_count']}")

    if report['gpu'].get('gpu_name'):
        print(f"GPU Hardware: {report['gpu']['gpu_name']} (Driver: {report['gpu']['driver_version']})")
        print(f"GPU VRAM:     {report['gpu']['vram_free_mb']} MB free / {report['gpu']['vram_total_mb']} MB total")

    print(f"CPU Types:    {', '.join(report['speech_runtime']['cpu_compute_types'])}")
    if report['speech_runtime']['cuda_device_count'] > 0:
        print(f"CUDA Types:   {', '.join(report['speech_runtime']['cuda_compute_types'])}")
        print(f"int8_float16: {'SUPPORTED' if report['speech_runtime']['int8_float16_supported'] else 'UNSUPPORTED'}")
    else:
        print("CUDA Types:   N/A (No CUDA devices detected)")

    print(f"Database:     {'CONNECTED' if report['database']['connected'] else 'ERROR / UNINITIALIZED'}")
    print(f"Cached Models: {', '.join(report['models']['cached_models']) if report['models']['cached_models'] else 'None'}")
    print(f"AI Tutor:     {'ENABLED (' + report['tutor']['provider'] + ')' if report['tutor']['enabled'] else 'DISABLED (Optional Gemini key not set)'}")
    print("=" * 60)

if __name__ == "__main__":
    main()
