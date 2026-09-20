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

The exact cross-repository artifact digest is established only after Archivist maps the emitted JSON bytes. Engine does not self-certify Archivist custody.

## Non-goals

This branch does not implement live monitoring, scheduling, Admission, Work, Fabricator execution, TRACE dispatch, Archivist ingestion, Hall mutation, or autonomous routing.
