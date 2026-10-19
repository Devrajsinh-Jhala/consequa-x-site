"""Offline application integration: a timed-out delivery and captured readback.

This example consumes a read-only artifact-store snapshot fixture. It does not
execute a delivery, access credentials, call a model, or import the benchmark.
In an application, replace ``captured_readback`` with a separately authenticated
read adapter, and retain the source's observation and origin metadata verbatim.
"""

from hashlib import sha256
import json

from consequa_x import (
    Action, AgentAssessment, AssessmentStatus, Evidence, Event, EventType, Observation,
    OriginStatus, OutcomeContract, ResponseStatus, ToolResponse, TimeBase, Trace,
    VerificationResult, VerificationStatus,
    explain, verify,
)


REPORT = b"Quarterly report, approved revision 7.\n"


def _matches(action: Action, records: list[dict]) -> tuple[str, ...]:
    expected = action.contract.expected
    return tuple(record["effect_id"] for record in records
                 if record["artifact_path"] == expected["artifact_path"]
                 and record["sha256"] == expected["sha256"]
                 and action.registered_at_ms <= record["committed_at_ms"]
                 <= action.contract.deadline_ms
                 and record["present_through_ms"] >= action.contract.horizon_ms)


class ArtifactVerifier:
    """Interpret an exhaustive artifact history from an application-owned source.

    The predicate requires exactly one matching delivery revision committed from
    registration through the horizon. That revision must commit by the deadline
    and have a presence witness through the horizon. A second matching revision
    in this interval violates the contract, even if committed after the deadline.
    Revisions outside the interval do not count. A presence witness ending early
    leaves persistence unknown; it is not evidence that the revision disappeared.
    ``present_through_ms`` must be the read adapter's persistence witness, not an
    assertion copied from the agent or the delivery response. Source authenticity
    and the veracity of that witness are application responsibilities.

    When the outcome is known, the receipt's ``target_effect_ids`` names this
    action's revisions whose path, content and timing match the target, checked
    separately from origin metadata. That lets ``explain`` judge the agent's
    report without any artifact-specific logic of its own.
    """

    def verify(self, action: Action, observation: Observation) -> VerificationResult:
        contract = action.contract
        if (contract.predicate != "artifact_delivered" or contract.exact_count != 1
                or set(contract.expected) != {"artifact_path", "sha256"}
                or any(not isinstance(value, str) or not value.strip()
                       for value in contract.expected.values())
                or contract.deadline_ms < action.registered_at_ms):
            raise ValueError("This adapter requires a bounded, exactly-one artifact contract")
        records = [dict(record) for record in observation.records]
        evidence = (Evidence(observation_id=observation.observation_id, source=observation.source, as_of_ms=observation.as_of_ms, details={
            "scope": observation.scope, "records": records, "complete": observation.complete,
            "available": observation.available,
        }),)

        def result(status, reason, origin=OriginStatus.UNKNOWN, ids=(), linked=()):
            target = None
            if status is not VerificationStatus.UNKNOWN:
                target = tuple(item for item in _matches(action, records) if item in linked)
            return VerificationResult(
                action_id=action.action_id, contract_id=contract.contract_id, status=status,
                observed_at_ms=observation.observed_at_ms, evidence=evidence, origin=origin,
                effect_ids=ids, attributable_effect_ids=linked, target_effect_ids=target,
                reason=reason)

        if (not observation.available or not observation.complete
                or observation.scope.get("artifact_path") != contract.expected["artifact_path"]
                or observation.as_of_ms < contract.horizon_ms):
            return result(VerificationStatus.UNKNOWN, "Readback does not cover the artifact horizon")
        identifiers = set()
        for record in records:
            if (any(not isinstance(record.get(key), str) or not record[key].strip()
                    for key in ("effect_id", "artifact_path", "sha256"))
                    or record["effect_id"] in identifiers
                    or record["artifact_path"] != observation.scope["artifact_path"]
                    or type(record.get("committed_at_ms")) is not int
                    or type(record.get("present_through_ms")) is not int
                    or not 0 <= record["committed_at_ms"] <= record["present_through_ms"]
                    <= observation.as_of_ms
                    or any(key in record and (
                        not isinstance(record[key], str) or not record[key].strip())
                        for key in ("action_id", "actor", "attempt_id"))):
                return result(VerificationStatus.UNKNOWN, "Artifact readback record is malformed")
            identifiers.add(record["effect_id"])
        relevant = [record for record in records
                    if action.registered_at_ms <= record["committed_at_ms"] <= contract.horizon_ms]
        ids = tuple(record["effect_id"] for record in relevant)
        linked = tuple(record["effect_id"] for record in relevant
                       if record.get("action_id") == action.action_id
                       and record.get("actor") == action.actor)
        if linked:
            origin = OriginStatus.CONFIRMED
        elif relevant and all(record.get("actor") and record["actor"] != action.actor
                              and record.get("action_id") != action.action_id for record in relevant):
            origin = OriginStatus.OTHER_ACTOR
        else:
            origin = OriginStatus.UNKNOWN
        deliveries = [record for record in relevant
                      if record["artifact_path"] == contract.expected["artifact_path"]
                      and record["sha256"] == contract.expected["sha256"]]
        if len(deliveries) != 1 or deliveries[0]["committed_at_ms"] > contract.deadline_ms:
            return result(VerificationStatus.VIOLATED,
                          "Exactly-one matching delivery through the horizon or deadline violated",
                          origin, ids, linked)
        if deliveries[0]["present_through_ms"] < contract.horizon_ms:
            return result(VerificationStatus.UNKNOWN,
                          "Presence witness does not establish persistence through the horizon",
                          origin, ids, linked)
        return result(VerificationStatus.SATISFIED,
                      "One matching delivery committed by deadline and persisted through horizon",
                      origin, ids, linked)


def captured_readback(
    artifact_bytes: bytes | None = REPORT, *, available: bool = True,
    actor: str | None = "delivery-agent", action_id: str | None = "deliver-report",
) -> Observation:
    """Construct a fixture from independently captured content and store metadata.

    Hash the bytes actually read back, rather than copying the requested digest.
    The fixture represents a separate source; it is not delivery-response data.
    """
    records = []
    if artifact_bytes is not None:
        record = {
            "effect_id": "artifact-revision-7", "artifact_path": "reports/quarterly.txt",
            "sha256": sha256(artifact_bytes).hexdigest(), "committed_at_ms": 25,
            "present_through_ms": 100,
        }
        if actor is not None:
            record["actor"] = actor
        if action_id is not None:
            record["action_id"] = action_id
        records.append(record)
    return Observation(observation_id="artifact-snapshot-1", source="artifact-store/read-only-snapshot", observed_at_ms=100, as_of_ms=100,
                       scope={"artifact_path": "reports/quarterly.txt"}, records=tuple(records),
                       available=available)


def build_trace(observation: Observation | None = None) -> Trace:
    expected = {"artifact_path": "reports/quarterly.txt", "sha256": sha256(REPORT).hexdigest()}
    action = Action(action_id="deliver-report", actor="delivery-agent", name="deliver_artifact",
                    arguments=expected, registered_at_ms=0, contract=OutcomeContract(contract_id="delivery-contract", predicate="artifact_delivered",
                                                 expected=expected, deadline_ms=50, stability_ms=20))
    events = (
        Event(id="delivery-decision", type=EventType.AGENT_DECISION, time_ms=1,
              actor=action.actor, data={"decision": "deliver_artifact"}),
        Event(id="delivery-dispatch", type=EventType.ACTION_DISPATCH, time_ms=5,
              actor=action.actor, parent_ids=("delivery-decision",),
              data={"action_id": action.action_id, "attempt_id": "delivery-attempt-1"}),
        Event(id="delivery-timeout", type=EventType.TOOL_RESPONSE, time_ms=10,
              parent_ids=("delivery-dispatch",), data={"attempt_id": "delivery-attempt-1"}),
    )
    response = ToolResponse(attempt_id="delivery-attempt-1", status=ResponseStatus.TIMEOUT, time_ms=10, provider_request_id="request-1",
                            result={"message": "Delivery acknowledgement was not received"}, action_id=action.action_id)
    assessment = AgentAssessment(status=AssessmentStatus.FAILURE, time_ms=11, evidence_event_ids=("delivery-timeout",),
                                 rationale="The delivery timed out, so I reported failure.", assessment_id="delivery-assessment", action_id=action.action_id)
    observation = captured_readback() if observation is None else observation
    receipt = verify(action, observation, verifier=ArtifactVerifier())
    return Trace(trace_id="artifact-delivery", time_base=TimeBase.RELATIVE_MS, actions=(action,), events=events, responses=(response,), assessments=(assessment,),
                 observations=(observation,), verifications=(receipt,))


if __name__ == "__main__":
    restored = Trace.from_json(build_trace().to_json())
    explanation = explain(restored)
    print(json.dumps({"trace": restored.to_dict(), "explanation": explanation.to_dict()}, indent=2))
