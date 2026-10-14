"""Runs untrusted pytest suites for Sideagent. Stdlib only; never imports job code.

  run [--timeout N] -- <test paths...>
      Laptop runners: run public tests in /work and print the pytest output.
  check
      HQ: score /job/result against each /job/tests/<category>/ and write /out/summary.json
      (counts only), or /out/error.json when the result is rejected. When /job/config.json asks
      for mutants, also score the tests themselves: how many small breaking changes to the
      result they catch, in /out/mutants.json.

Code under test runs in a child process with a fixed environment and its own process group. See
"Test sandbox" in docs/technical.md for the known gaps.
"""

import argparse
import ast
import json
import os
import shutil
import signal
import subprocess
import sys
import time
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
MAX_MUTANTS = 50
# Per pytest run on a mutant; a mutant that loops until then counts as caught.
MUTANT_TIMEOUT = 10
# All mutants together; mutants not started by then are left out of the score, which keeps the
# whole review run inside HQ's sandbox timeout.
MUTANT_BUDGET = 120
MUTANT_DIR = Path("/tmp/mutant")

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
    category: str, result: list[PurePosixPath], timeout: int, source: Path = JOB / "result"
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
    copy_tree(source, result, work)
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


# Operator swaps for mutants: each turns working code into nearly the same, wrong code.
SWAPS: dict[type, type] = {
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.Lt: ast.GtE,
    ast.GtE: ast.Lt,
    ast.Gt: ast.LtE,
    ast.LtE: ast.Gt,
    ast.In: ast.NotIn,
    ast.NotIn: ast.In,
    ast.Is: ast.IsNot,
    ast.IsNot: ast.Is,
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
    ast.Mult: ast.FloorDiv,
    ast.Div: ast.Mult,
    ast.FloorDiv: ast.Mult,
    ast.Mod: ast.FloorDiv,
    ast.And: ast.Or,
    ast.Or: ast.And,
}


class Mutator(ast.NodeTransformer):
    """Numbers mutation sites in source order and applies the one numbered `target` (-1: none).

    Children are numbered before their parent, so a count with target -1 and a later run with a
    target agree on every site up to the target."""

    def __init__(self, target: int):
        self.target = target
        self.sites = 0

    def hit(self) -> bool:
        self.sites += 1
        return self.sites - 1 == self.target

    def visit_Expr(self, node: ast.Expr) -> ast.AST:
        # A docstring or bare constant does nothing, so changing it would never be caught.
        return node if isinstance(node.value, ast.Constant) else self.generic_visit(node)

    def visit_arg(self, node: ast.arg) -> ast.AST:
        # Annotations don't run.
        return node

    def visit_Raise(self, node: ast.Raise) -> ast.AST:
        # Error messages are rarely part of a spec; tests that check the error type still pass.
        return node

    def visit_Compare(self, node: ast.Compare) -> ast.AST:
        self.generic_visit(node)
        for i, op in enumerate(node.ops):
            if type(op) in SWAPS and self.hit():
                node.ops[i] = SWAPS[type(op)]()
        return node

    def swap_op(self, node: ast.BinOp | ast.AugAssign | ast.BoolOp) -> ast.AST:
        self.generic_visit(node)
        if type(node.op) in SWAPS and self.hit():
            node.op = SWAPS[type(node.op)]()
        return node

    visit_BinOp = visit_AugAssign = visit_BoolOp = swap_op

    def visit_UnaryOp(self, node: ast.UnaryOp) -> ast.AST:
        self.generic_visit(node)
        if isinstance(node.op, (ast.Not, ast.USub)) and self.hit():
            return node.operand
        return node

    def visit_Constant(self, node: ast.Constant) -> ast.AST:
        value = node.value
        if isinstance(value, bool):
            if self.hit():
                return ast.Constant(not value)
        elif isinstance(value, (int, float)):
            if self.hit():
                return ast.Constant(value + 1)
        elif isinstance(value, str):
            if self.hit():
                return ast.Constant(value + "XX")
        return node

    def visit_Return(self, node: ast.Return) -> ast.AST:
        self.generic_visit(node)
        returns_none = node.value is None or (
            isinstance(node.value, ast.Constant) and node.value.value is None
        )
        if not returns_none and self.hit():
            return ast.Return(None)
        return node

    def visit_Call(self, node: ast.Call) -> ast.AST:
        # `text.lower()` → `text`: drops a no-argument method call.
        self.generic_visit(node)
        if isinstance(node.func, ast.Attribute) and not node.args and not node.keywords:
            if self.hit():
                return node.func.value
        return node


def count_sites(source: str) -> int:
    counter = Mutator(-1)
    counter.visit(ast.parse(source))
    return counter.sites


def mutate(source: str, site: int) -> str:
    tree = Mutator(site).visit(ast.parse(source))
    return ast.unparse(ast.fix_missing_locations(tree))


def plan_mutants(result: list[PurePosixPath], limit: int) -> list[tuple[PurePosixPath, str]]:
    """Up to `limit` (file, mutated source) pairs, spread evenly over every site in the result's
    code files. Files that don't parse are skipped: the tests decide whether they matter."""
    sites: list[tuple[PurePosixPath, str, int]] = []
    for rel in result:
        if rel.suffix != ".py" or is_test_file(rel):
            continue
        source = (JOB / "result" / rel).read_text(errors="replace")
        try:
            sites.extend((rel, source, i) for i in range(count_sites(source)))
        except (SyntaxError, ValueError, RecursionError):
            continue
    if len(sites) > limit:
        sites = [sites[i * len(sites) // limit] for i in range(limit)]
    return [(rel, mutate(source, i)) for rel, source, i in sites]


def score_mutants(
    result: list[PurePosixPath], categories: list[str], limit: int, timeout: int
) -> dict:
    """Mutants of the result, and how many the tests in `categories` catch (any test fails)."""
    deadline = time.monotonic() + MUTANT_BUDGET
    killed = run = 0
    for rel, source in plan_mutants(result, limit):
        if time.monotonic() > deadline:
            break
        run += 1
        shutil.rmtree(MUTANT_DIR, ignore_errors=True)
        copy_tree(JOB / "result", result, MUTANT_DIR)
        (MUTANT_DIR / rel).write_text(source)
        for category in categories:
            passed, total = score_category(
                category, result, min(timeout, MUTANT_TIMEOUT), MUTANT_DIR
            )
            if passed < total:
                killed += 1
                break
    shutil.rmtree(MUTANT_DIR, ignore_errors=True)
    return {"killed": killed, "total": run}


def load_config() -> tuple[int, dict | None]:
    """Per-category timeout, and the mutants request: {"limit": N, "categories": [...]}."""
    try:
        config = json.loads((JOB / "config.json").read_text())
    except FileNotFoundError:
        return DEFAULT_TIMEOUT, None
    timeout = config.get("timeout_seconds", DEFAULT_TIMEOUT)
    if type(timeout) is not int or not 1 <= timeout <= MAX_TIMEOUT:
        raise SystemExit(f"timeout_seconds must be an integer from 1 to {MAX_TIMEOUT}")
    mutants = config.get("mutants")
    if mutants is not None:
        if not isinstance(mutants, dict):
            raise SystemExit("mutants must be an object with limit and categories")
        limit, categories = mutants.get("limit"), mutants.get("categories")
        if type(limit) is not int or not 1 <= limit <= MAX_MUTANTS:
            raise SystemExit(f"mutants.limit must be an integer from 1 to {MAX_MUTANTS}")
        if not isinstance(categories, list) or not all(isinstance(c, str) for c in categories):
            raise SystemExit("mutants.categories must be a list of category names")
    return timeout, mutants


def write_outputs(outputs: dict[str, dict]) -> None:
    # Written last, after every test process is dead, so they replace anything a test wrote.
    for stale in ("summary.json", "error.json", "mutants.json"):
        (OUT / stale).unlink(missing_ok=True)
    for name, body in outputs.items():
        (OUT / name).write_text(json.dumps(body))


def check() -> int:
    timeout, mutants = load_config()
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
        outputs = {"summary.json": summary}
        # Mutants only mean something when the unchanged result passes the tests they run.
        scored = [summary["categories"].get(c) for c in mutants["categories"]] if mutants else []
        if scored and all(c and c["passed"] == c["total"] for c in scored):
            outputs["mutants.json"] = score_mutants(
                result, mutants["categories"], mutants["limit"], timeout
            )
    except Rejected as err:
        write_outputs(
            {
                "error.json": {
                    "code": "invalid_request",
                    "reason": err.reason,
                    "fix_hint": err.fix_hint,
                }
            }
        )
        return 2
    write_outputs(outputs)
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
