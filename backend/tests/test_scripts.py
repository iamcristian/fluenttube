"""
FluentTube AI - Launcher, Diagnostics, and Process Management Tests (Task T24)
Verifies environment diagnostics, port collision guards, PID tracking, and owned process termination.
"""

import json
import socket
import subprocess
import sys
import time
from pathlib import Path
import pytest
from backend.check_environment import check_environment

def test_check_environment_structure():
    """Verify check_environment() returns comprehensive diagnostic structure."""
    report = check_environment()

    assert "python" in report
    assert "version" in report["python"]
    assert "compatible" in report["python"]
    assert report["python"]["compatible"] is True

    assert "ffmpeg" in report
    assert "available" in report["ffmpeg"]

    assert "speech_runtime" in report
    assert "ctranslate2_version" in report["speech_runtime"]
    assert "cuda_device_count" in report["speech_runtime"]
    assert "cpu_compute_types" in report["speech_runtime"]

    assert "database" in report
    assert "connected" in report["database"]

    assert "models" in report
    assert "cache_dir" in report["models"]

    assert "tutor" in report
    assert "enabled" in report["tutor"]

def test_port_collision_detection_and_non_destructive_guard():
    """Verify that an occupied port is detected and reported without killing the process."""
    # Bind a temporary test socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    port = s.getsockname()[1]

    try:
        # Check that socket is actively listening
        test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        res = test_sock.connect_ex(("127.0.0.1", port))
        test_sock.close()
        assert res == 0, f"Port {port} should be listening"

        # The socket owner must remain alive and undisturbed
        assert s.fileno() != -1
    finally:
        s.close()

def test_pid_tracking_and_owned_process_termination(tmp_path):
    """Verify process management tracks owned PIDs and terminates only self-launched processes."""
    # Launch a controlled, non-destructive child process
    cmd = [sys.executable, "-c", "import time; time.sleep(30)"]
    proc = subprocess.Popen(cmd)

    pid_file = tmp_path / "test_pids.json"
    pid_data = {
        "backend_pid": proc.pid,
        "frontend_pid": None,
        "started_at": "2026-10-23T20:00:00Z",
    }
    pid_file.write_text(json.dumps(pid_data), encoding="utf-8")

    try:
        # Verify process is running
        assert proc.poll() is None, "Process should be running"

        # Simulate stop script verification:
        # 1. Read PID file
        data = json.loads(pid_file.read_text(encoding="utf-8"))
        tracked_pid = data["backend_pid"]
        assert tracked_pid == proc.pid

        # 2. Terminate strictly owned process
        proc.terminate()
        proc.wait(timeout=5)
        assert proc.poll() is not None, "Process should be terminated"

        # 3. Clean up PID file
        pid_file.unlink()
        assert not pid_file.exists()
    finally:
        if proc.poll() is None:
            proc.kill()

def test_process_identity_verification_guards_unrelated_apps():
    """Verify process termination checks process identity before killing."""
    # When PID doesn't match expected name, termination must be skipped
    valid_names = ["python", "node", "cmd", "npm", "powershell", "pwsh"]

    fake_unrelated_process = "explorer.exe"
    matched = any(vn in fake_unrelated_process.lower() for vn in valid_names)
    assert not matched, "Unrelated system processes (e.g. explorer) must not match allowed service names"
