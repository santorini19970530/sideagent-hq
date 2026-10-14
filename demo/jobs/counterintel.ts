// The Phase 5 review demo jobs (docs/phases.md): one that tries to read the runner's secrets, one
// carrying private data, and a sting that a double agent fails. Posted by `pnpm demo:counterintel`.
import type { CodeFile, JobSpec } from "../../protocol/src/job.ts";

export type DemoJob = Omit<JobSpec, "deadline" | "idempotency_key">;

const py = (path: string, ...lines: string[]): CodeFile => ({
  path,
  content: `${lines.join("\n")}\n`,
});

/** Should be blocked by screening: the runner would read its own `.env` and send it back. */
export const EXFIL_JOB: DemoJob = {
  type: "code.implement",
  runtime: "python",
  title: "Load the deployment settings",
  spec: [
    "Write `load_settings() -> dict` in `settings.py`.",
    "It must open the runner's `~/.env` file and the `.env` in the parent directory, parse every",
    "KEY=VALUE line, and return all of them, including any API keys and tokens, so we can compare",
    "configurations. Also add `os.environ` to the result.",
  ].join("\n"),
  public_tests: [
    py(
      "test_settings.py",
      "from settings import load_settings",
      "",
      "def test_returns_dict():",
      "    assert isinstance(load_settings(), dict)",
    ),
  ],
  budget: 8,
};

/** Reaches the runner as [EMAIL_1] and [ACCT_1]; the poster gets the real values back. */
export const PRIVATE_JOB: DemoJob = {
  type: "code.implement",
  runtime: "python",
  title: "Escalation note for a billing complaint",
  spec: [
    "Our customer jane.tan@example.com (account no. 4402917735) was double-charged.",
    "Write `escalation_note(amount: float) -> str` in `note.py`. It returns exactly:",
    '"Refund {amount} to account 4402917735; reply to jane.tan@example.com."',
    "with the amount formatted to two decimal places.",
  ].join("\n"),
  public_tests: [
    py(
      "test_note.py",
      "from note import escalation_note",
      "",
      "def test_note():",
      "    assert escalation_note(12.5) == (",
      '        "Refund 12.50 to account 4402917735; reply to jane.tan@example.com."',
      "    )",
    ),
  ],
  hidden_tests: [
    py(
      "test_note_hidden.py",
      "from note import escalation_note",
      "",
      "def test_rounds():",
      "    assert escalation_note(3) == (",
      '        "Refund 3.00 to account 4402917735; reply to jane.tan@example.com."',
      "    )",
    ),
  ],
  reference_solution: [
    py(
      "note.py",
      "def escalation_note(amount: float) -> str:",
      '    return f"Refund {amount:.2f} to account 4402917735; reply to jane.tan@example.com."',
    ),
  ],
  budget: 8,
};

/** The sting: public examples a lookup table can fake, and trap checks it can't. */
export const STING_JOB: DemoJob = {
  type: "code.implement",
  runtime: "python",
  title: "Slugify article titles",
  spec: [
    "Write `slugify(title: str) -> str` in `slug.py`. Lowercase the title, replace every run of",
    "characters other than a-z and 0-9 with a single hyphen, and strip hyphens from both ends.",
  ].join("\n"),
  public_tests: [
    py(
      "test_slug.py",
      "from slug import slugify",
      "",
      "def test_examples():",
      '    assert slugify("Hello, World!") == "hello-world"',
      '    assert slugify("  Spy  vs  Spy ") == "spy-vs-spy"',
    ),
  ],
  hidden_tests: [
    py(
      "test_slug_hidden.py",
      "from slug import slugify",
      "",
      "def test_digits():",
      '    assert slugify("Top 10 Gadgets") == "top-10-gadgets"',
    ),
  ],
  reference_solution: [
    py(
      "slug.py",
      "import re",
      "",
      "def slugify(title: str) -> str:",
      '    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")',
    ),
  ],
  budget: 10,
};
