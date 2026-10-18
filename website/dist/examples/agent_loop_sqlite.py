"""A tool-calling agent loop, captured with Consequa-X and checked against SQLite.

Standard library only, offline and deterministic. A scripted support agent reads
a customer message, decides to call an ``issue_refund`` tool, and reports what it
believes happened. The tool writes to a real SQLite database. Consequa-X
records the loop as it runs, then reads the outcome back through a separate
read-only connection and verifies it with the built-in ``RecordVerifier``.

Three modes show why the tool's response and the agent's report are not the
outcome:

- ``timeout_after_commit``: the refund row is written, then the tool times out.
  The agent reports failure; readback shows the refund, linked to this action.
- ``other_actor``: the tool times out before writing, and a support colleague
  issues the same refund by hand. The state is satisfied by someone else.
- ``stale_readback``: the tool succeeds, but readback comes from a replica that
  lags behind the contract horizon, so the outcome stays unknown.

Run from this folder with Consequa-X 1.2 or newer installed::

    python agent_loop_sqlite.py --mode timeout_after_commit --output agent-run

The output folder must be new. It receives the SQLite database, the captured
trace, its explanation and a self-contained HTML report. No money moves: the
"refund" is a row in a local file. Times are simulated milliseconds.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from consequa_x import (
    Observation, OutcomeContract, RecordVerifier, TraceRecorder, explain, render_report,
)


MODES = ("timeout_after_commit", "other_actor", "stale_readback")
ORDER = {"order_id": "o-17", "amount_minor": 5000, "currency": "INR"}
MESSAGE = "Order o-17 arrived damaged. Please refund the INR 50 I paid."
AGENT = "support-agent"
# The contract: exactly one matching refund row by 200 ms, still present at 250 ms.
CONTRACT = OutcomeContract("refund-o-17", "record_present", dict(ORDER),
                           deadline_ms=200, exact_count=1, stability_ms=50)
VERIFIER = RecordVerifier(scope_fields=("order_id",))
SCHEMA = """CREATE TABLE refunds (
    effect_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL, committed_at_ms INTEGER NOT NULL, removed_at_ms INTEGER,
    action_id TEXT, attempt_id TEXT, actor TEXT)"""


class SimulatedClock:
    """Deterministic milliseconds, so every run of a mode records the same trace."""

    def __init__(self) -> None:
        self.ms = 0

    def __call__(self) -> int:
        return self.ms

    def advance_to(self, ms: int) -> None:
        if ms < self.ms:
            raise ValueError("the simulated clock never runs backwards")
        self.ms = ms


class RefundService:
    """The system the agent changes: a refunds table in a SQLite file."""

    def __init__(self, path: Path, clock: SimulatedClock) -> None:
        self.path = path
        self.clock = clock
        with closing(sqlite3.connect(path)) as connection, connection:
            connection.execute(SCHEMA)

    def write(self, effect_id: str, *, action_id=None, attempt_id=None, actor=None) -> None:
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute(
                "INSERT INTO refunds (effect_id, order_id, amount_minor, currency, "
                "committed_at_ms, action_id, attempt_id, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (effect_id, ORDER["order_id"], ORDER["amount_minor"], ORDER["currency"],
                 self.clock(), action_id, attempt_id, actor))

    def snapshot(self, destination: Path) -> int:
        """Copy the database as a lagging replica; returns its watermark."""
        with closing(sqlite3.connect(self.path)) as source,                 closing(sqlite3.connect(destination)) as replica:
            source.backup(replica)
        return self.clock()


def issue_refund(service: RefundService, clock: SimulatedClock, mode: str, *,
                 order_id: str, amount_minor: int, currency: str,
                 action_id: str, attempt_id: str) -> dict:
    """The tool. Like many payment APIs, it stores request metadata with the effect."""
    if (order_id, amount_minor, currency) != tuple(ORDER.values()):
        raise ValueError("unexpected refund request")
    if mode == "other_actor":
        clock.advance_to(40)
        raise TimeoutError("refund gateway timed out before reaching the ledger")
    clock.advance_to(12)
    service.write("rf-1", action_id=action_id, attempt_id=attempt_id, actor=AGENT)
    if mode == "timeout_after_commit":
        clock.advance_to(40)
        raise TimeoutError("refund gateway timed out after the ledger committed")
    clock.advance_to(18)
    return {"refund_id": "rf-1", "status": "accepted"}


def read_back(path: Path, *, observation_id: str, observed_at_ms: int,
              watermark_ms: int) -> Observation:
    """Query the refunds for this order over a read-only connection."""
    uri = f"file:{path.as_posix()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute("SELECT * FROM refunds WHERE order_id = ? ORDER BY effect_id",
                                  (ORDER["order_id"],)).fetchall()
    records = tuple({key: row[key] for key in row.keys() if row[key] is not None} for row in rows)
    return Observation(observation_id, f"{path.name} (read-only)", observed_at_ms, watermark_ms,
                       {"order_id": ORDER["order_id"]}, records)


def run(mode: str, output: Path) -> dict:
    """Run one mode into a new folder and return its summary."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    clock = SimulatedClock()
    service = RefundService(output / "refunds.sqlite", clock)
    rec = TraceRecorder(f"agent-loop-{mode}", actor=AGENT, clock=clock)

    # 1. The agent reads the request and decides to call the refund tool.
    message = rec.context("user_input", {"text": MESSAGE})
    clock.advance_to(2)
    rec.decision({"tool": "issue_refund", "reason": "damaged on arrival"}, inputs=(message,))
    clock.advance_to(3)
    rec.register("refund-o-17", "issue_refund", dict(ORDER), contract=CONTRACT)

    # 2. The loop calls the tool; the recorder captures the dispatch and response.
    clock.advance_to(5)
    reported = "success"
    try:
        with rec.attempt(data={"tool": "issue_refund"}) as attempt:
            result = issue_refund(service, clock, mode, **ORDER,
                                  action_id="refund-o-17", attempt_id=attempt.attempt_id)
            attempt.result = result
    except TimeoutError:
        reported = "failure"

    # 3. The agent reports what it believes happened, based on the tool response.
    clock.advance_to(41)
    rec.assessment(reported, rationale="The refund tool timed out." if reported == "failure"
                   else "The refund tool accepted the request.")
    if mode == "other_actor":
        clock.advance_to(90)
        service.write("rf-staff-1", actor="support-staff")  # issued by hand, no agent metadata

    # 4. Independent readback after the horizon, then verification.
    if mode == "stale_readback":
        clock.advance_to(120)
        replica = output / "replica.sqlite"
        watermark = service.snapshot(replica)
        clock.advance_to(300)
        observation = read_back(replica, observation_id="readback-1",
                                observed_at_ms=clock(), watermark_ms=watermark)
    else:
        clock.advance_to(300)
        observation = read_back(service.path, observation_id="readback-1",
                                observed_at_ms=clock(), watermark_ms=clock())
    receipt = rec.verify(observation, verifier=VERIFIER)

    trace = rec.trace()
    explanation = explain(trace, target_matcher=VERIFIER.target_matcher())
    (output / "trace.json").write_text(trace.to_json(indent=2), encoding="utf-8")
    (output / "explanation.json").write_text(
        json.dumps(explanation.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
    (output / "report.html").write_text(render_report(trace), encoding="utf-8")
    return {
        "mode": mode, "tool_response": trace.responses[-1].status.value,
        "agent_reported": trace.assessment.status.value, "state": receipt.status.value,
        "origin": receipt.origin.value, "alignment": explanation.assessment_alignment,
        "diagnoses": list(explanation.diagnoses), "reason": receipt.reason,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mode", choices=MODES, default="timeout_after_commit")
    parser.add_argument("--output", type=Path, help="A new folder (default: agent-run-MODE)")
    args = parser.parse_args(argv)
    output = args.output or Path(f"agent-run-{args.mode}")
    summary = run(args.mode, output)
    for key in ("tool_response", "agent_reported", "state", "origin", "alignment"):
        print(f"{key.replace('_', ' '):>15}: {summary[key]}")
    print(f"{'diagnoses':>15}: {', '.join(summary['diagnoses'])}")
    print(f"Open {(output / 'report.html').resolve()} in your browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
