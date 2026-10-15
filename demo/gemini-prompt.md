You're helping our billing team. Delegate this small coding task to Sideagent with the sideagent MCP server's post_job tool, then tell me the job_id it returns.

- type "code.implement", runtime "python", title "Escalation note for a billing complaint", budget 8, deadline one hour from now (ISO 8601, UTC), and a new random idempotency_key.
- spec, exactly these four lines:
  Our customer jane.tan@example.com (account no. 4402917735) was double-charged.
  Write `escalation_note(amount: float) -> str` in `note.py`. It returns exactly:
  "Refund {amount} to account 4402917735; reply to jane.tan@example.com."
  with the amount formatted to two decimal places.
- public_tests: one file, path "test_note.py", content:
  from note import escalation_note

  def test_note():
      assert escalation_note(12.5) == (
          "Refund 12.50 to account 4402917735; reply to jane.tan@example.com."
      )
- hidden_tests: one file, path "test_note_hidden.py", content:
  from note import escalation_note

  def test_rounds():
      assert escalation_note(3) == (
          "Refund 3.00 to account 4402917735; reply to jane.tan@example.com."
      )
- reference_solution: one file, path "note.py", content:
  def escalation_note(amount: float) -> str:
      return f"Refund {amount:.2f} to account 4402917735; reply to jane.tan@example.com."
