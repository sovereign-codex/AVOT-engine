# ERA-AVOT-CIRCULATION-001 — Current-main monitor × inference conduction

Status: implementation fixture on a non-default branch. Non-canonical and non-authorizing.

## Purpose

Restage the still-valid portion of historical CIT Pilot 02 against current AVOT-engine main without merging the stale branch.

The adapter composes already-existing contracts:

```text
MonitorActivationResult
  -> material SignalPacketV01?
  -> SovereignInferenceRequest
  -> current sovereign inference round trip
  -> TRACE-compatible + Archivist-compatible evidence
  -> non-authorizing review handoff
```

## Boundaries

- perception != authority
- inference != authority
- review handoff != Admission
- no Work creation
- no execution authorization
- no repository mutation
- no institutional-memory mutation
- no Canon promotion

No-material-change returns without recruiting inference.

Refused, degraded, and failed inference remain non-success states and do not produce a council handoff.

## Evidence identity

For fixture event `era-avot-circulation-001`:

- signal: `signal:era-avot-circulation-001`
- inference request: `monitor-conduction:era-avot-circulation-001`
- inference evidence / TRACE identity: `inference:monitor-conduction:era-avot-circulation-001`

The Engine test derives the committed fixture bytes from the current conduction implementation under a deterministic capture time, then pins SHA-256 `d1b20d1bd5571ff64902ff05dd163dd5648644497b401ce9e7028c42288b4c7e`. Archivist independently hashes and validates those exact bytes. Engine does not self-certify Archivist custody.

## Provenance preservation

The first fixture deliberately distinguishes:

- raw source ref: `source:era-avot-circulation-raw-001`
- derived signal evidence ref: `evidence:era-avot-circulation-derived-001`

Both must survive into inference context and the final conduction handoff.

## Stage-local handoff semantics

`monitor_evidence_return.handoff_target` preserves the **pre-conduction monitor recommendation** as historical provenance. The top-level `handoff.target` is the **post-inference conduction recommendation**. Refused, degraded, and failed inference therefore preserve the earlier monitor recommendation while returning a null final conduction target.

## Non-goals

This branch does not implement live monitoring, scheduling, Admission, Work, Fabricator execution, TRACE dispatch, Archivist ingestion, Hall mutation, or autonomous routing.
