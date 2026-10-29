"""Check publishable files and optional Git history without printing secret values.

This is a focused check for common credential formats, not a complete secret detector.
Run from any directory: python scripts/check_secrets.py [--history]
"""
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "Google API key": re.compile(rb"AIza[0-9A-Za-z_-]{35}"),
    "GitHub token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})"),
    "OpenAI key": re.compile(rb"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}"),
    "AWS access key": re.compile(rb"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    "Private key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "Credential in URL": re.compile(rb"https?://[^\s/:<>]+:[^\s/@<>]+@"),
}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def inspect(label, content):
    findings = []
    for name, pattern in PATTERNS.items():
        for match in pattern.finditer(content):
            # Deliberate invalid URL fixture, not an actual login.
            if name == "Credential in URL" and label.endswith("backend/tests/test_youtube_url.py") and match.group() == b"https://user:" + b"password@":
                continue
            line = content[:match.start()].count(b"\n") + 1
            findings.append(f"{label}:{line}: possible {name} (value hidden)")
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    findings = []
    paths = set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""}
    for name in sorted(paths):
        path = ROOT / name
        if not path.is_file():
            continue
        if path.name == ".env" or (path.name.startswith(".env.") and path.name != ".env.example"):
            findings.append(f"{name}: private environment file is publishable")
        if path.stat().st_size > 2_000_000:
            findings.append(f"{name}: larger than 2 MB; review before publishing")
            continue
        findings.extend(inspect(name, path.read_bytes()))
    if args.history:
        # Read historical blobs, including files subsequently deleted or ignored.
        for entry in git("rev-list", "--objects", "--all").decode().splitlines():
            oid, _, name = entry.partition(" ")
            if not name or git("cat-file", "-t", oid).strip() != b"blob":
                continue
            findings.extend(inspect(f"history/{oid[:10]}/{name}", git("cat-file", "blob", oid)))
            if Path(name).name == ".env":
                findings.append(f"history/{oid[:10]}/{name}: private environment file committed")
    for finding in findings:
        print(finding)
    print(f"Checked {len(paths)} publishable paths" + (" and Git history" if args.history else "") + f"; {len(findings)} findings.")
    return bool(findings)


if __name__ == "__main__":
    raise SystemExit(main())
