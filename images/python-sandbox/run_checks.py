"""Runs untrusted pytest suites for Sideagent. Stdlib only; never imports job code.

  run [--timeout N] -- <test paths...>
      Laptop runners: run public tests in /work and print the pytest output.
  check
      HQ: score /job/result against each /job/tests/<category>/ and write /out/summary.json
      (counts only), or /out/error.json when the result is rejected.

Code under test runs in a child process with a fixed environment and its own process group. See
"Test sandbox" in docs/technical.md for the known gaps.
"""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from typing import IO

PYTEST_INI = "/opt/sideagent/pytest.ini"
WORK = Path("/work")
JOB = Path("/job")
OUT = Path("/out")
SCRATCH = Path("/tmp/check")
SANDBOX_UID = 10001
DEFAULT_TIMEOUT = 60
MAX_TIMEOUT = 600
MAX_OUTPUT_BYTES = 64 * 1024

CHILD_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/tmp",
    "LANG": "C.UTF-8",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONNOUSERSITE": "1",
    "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
}

# Files that change how pytest or Python start up. A result containing one is rejected.
FORBIDDEN_NAMES = {
    "conftest.py",
    "pytest.ini",
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
    "sitecustomize.py",
    "usercustomize.py",
}


class Rejected(Exception):
    def __init__(self, reason: str, fix_hint: str):
        super().__init__(reason)
        self.reason = reason
        self.fix_hint = fix_hint


def forbidden(rel: PurePosixPath) -> bool:
    return any(
        part in FORBIDDEN_NAMES or part.endswith(".pth") or part.startswith(("pytest", "_pytest"))
        for part in rel.parts
    )


def is_test_file(rel: PurePosixPath) -> bool:
    return rel.suffix == ".py" and (rel.name.startswith("test_") or rel.name.endswith("_test.py"))


def list_files(root: Path) -> list[PurePosixPath]:
    """Regular files under root, relative to it. Symlinks are refused rather than followed."""
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(dirpath, name)
            if path.is_symlink():
                raise Rejected(
                    f"{path.relative_to(root)} is a symlink", "Submit regular files only."
                )
        files.extend(PurePosixPath(Path(dirpath, f).relative_to(root)) for f in filenames)
    return sorted(files)


def copy_tree(src: Path, files: list[PurePosixPath], dst: Path) -> None:
    for rel in files:
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src / rel, target)


def kill_strays(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    # Tests can start their own sessions. Inside the sandbox, kill every process of this user
    # except this one (Linux skips the caller and PID 1).
    if os.getuid() == SANDBOX_UID:
        try:
            os.kill(-1, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run_pytest(cwd: Path, args: list[str], timeout: int, stdout: int | IO[bytes]) -> int | None:
    """Exit code, or None on timeout. Every process the tests started is dead on return."""
    proc = subprocess.Popen(
        # The console script, not `python -m`, so cwd isn't on sys.path ahead of pytest.
        ["pytest", "-c", PYTEST_INI, "--rootdir", str(cwd), "--noconftest", *args],
        cwd=cwd,
        env=CHILD_ENV,
        stdin=subprocess.DEVNULL,
        stdout=stdout,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    finally:
        kill_strays(proc.pid)
        proc.wait()


def parse_junit(path: Path) -> tuple[int, int, int] | None:
    """(passed, failed, total). Failed counts failures and errors; skipped tests count as neither."""
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        return None
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
    try:
        def count(key: str) -> int:
            return sum(int(s.get(key, "0")) for s in suites)

        total, failed = count("tests"), count("failures") + count("errors")
        passed = max(total - failed - count("skipped"), 0)
    except ValueError:
        return None
    return passed, failed, total


def verdict(
    code: int | None, counts: tuple[int, int, int] | None, min_total: int
) -> tuple[int, int]:
    """(passed, total) for a category. A run that reports nothing fails min_total tests."""
    if code is None or counts is None:
        return 0, min_total
    passed, failed, total = counts
    # Exit code and report must agree; anything else (crash, interrupt, no tests) is a fail.
    if total > 0 and (code == 0) == (failed == 0) and code in (0, 1):
        return passed, total
    return 0, max(total, min_total)


def score_category(
    category: str, result: list[PurePosixPath], timeout: int
) -> tuple[int, int]:
    tests_dir = JOB / "tests" / category
    tests = list_files(tests_dir)
    if set(tests) & set(result):
        # Don't name the file: hidden test paths stay hidden.
        raise Rejected(
            "A result file has the same path as a test file",
            "Rename your files, for example after the module named in the spec.",
        )
    test_files = [t for t in tests if is_test_file(t)]

    work = SCRATCH / category
    junit = SCRATCH / f"{category}.xml"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    copy_tree(JOB / "result", result, work)
    copy_tree(tests_dir, tests, work)
    try:
        code = run_pytest(
            work,
            ["-q", f"--junitxml={junit}", "--", *map(str, test_files)],
            timeout,
            subprocess.DEVNULL,
        )
        counts = parse_junit(junit)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        junit.unlink(missing_ok=True)
    # At least one failed test per file when the run reports nothing usable.
    return verdict(code, counts, max(len(test_files), 1))


def load_timeout() -> int:
    try:
        config = json.loads((JOB / "config.json").read_text())
    except FileNotFoundError:
        return DEFAULT_TIMEOUT
    timeout = config.get("timeout_seconds", DEFAULT_TIMEOUT)
    if type(timeout) is not int or not 1 <= timeout <= MAX_TIMEOUT:
        raise SystemExit(f"timeout_seconds must be an integer from 1 to {MAX_TIMEOUT}")
    return timeout


def write_output(name: str, body: dict) -> None:
    # Written last, after every test process is dead, so it replaces anything a test wrote.
    for stale in ("summary.json", "error.json"):
        (OUT / stale).unlink(missing_ok=True)
    (OUT / name).write_text(json.dumps(body))


def check() -> int:
    timeout = load_timeout()
    categories = sorted(p.name for p in (JOB / "tests").iterdir() if p.is_dir())
    if not categories:
        raise SystemExit("No test categories in /job/tests")
    try:
        result = list_files(JOB / "result")
        for rel in result:
            if forbidden(rel):
                raise Rejected(
                    f"{rel} can't be part of a result: it changes how the tests run",
                    "Remove it, or rename it if it is part of your solution.",
                )
        summary = {"passed": 0, "total": 0, "categories": {}}
        for category in categories:
            passed, total = score_category(category, result, timeout)
            summary["categories"][category] = {"passed": passed, "total": total}
            summary["passed"] += passed
            summary["total"] += total
    except Rejected as err:
        write_output(
            "error.json",
            {"code": "invalid_request", "reason": err.reason, "fix_hint": err.fix_hint},
        )
        return 2
    write_output("summary.json", summary)
    return 0


def run(tests: list[str], timeout: int) -> int:
    log = Path("/tmp/run-output.txt")
    with log.open("w+b") as out:
        code = run_pytest(WORK, ["-q", "--", *tests], timeout, out)
        out.seek(0)
        output = out.read(MAX_OUTPUT_BYTES + 1)
    sys.stdout.write(output[:MAX_OUTPUT_BYTES].decode("utf-8", "replace"))
    if len(output) > MAX_OUTPUT_BYTES:
        sys.stdout.write("\n[output truncated]\n")
    if code is None:
        sys.stdout.write(f"\n[timed out after {timeout} seconds]\n")
        return 124
    return code


def main() -> int:
    parser = argparse.ArgumentParser(prog="run_checks.py")
    commands = parser.add_subparsers(dest="command", required=True)
    run_parser = commands.add_parser("run", help="run public tests in /work")
    run_parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    run_parser.add_argument("tests", nargs="+")
    commands.add_parser("check", help="score /job and write /out/summary.json")
    args = parser.parse_args()
    if args.command == "run":
        return run(args.tests, min(max(args.timeout, 1), MAX_TIMEOUT))
    return check()


if __name__ == "__main__":
    sys.exit(main())
