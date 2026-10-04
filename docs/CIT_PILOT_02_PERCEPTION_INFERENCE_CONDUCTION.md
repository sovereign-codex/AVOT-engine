# CIT Pilot 02 — Perception × Sovereign Inference Conduction

## Purpose

Prove one bounded end-to-end loop in which an AVOT monitor perceives a material signal, recruits local sovereign inference for interpretation, returns evidence to the CIT Monitor Council, and re-enters dormancy without gaining institutional authority.

## Canonical prerequisites

- Tyme-Lab Monitor Participation Runtime v0 contracts
- AVOT-engine Monitor Participation Runtime v0
- AVOT-engine Local Sovereign Inference Round Trip v0.1

## Conduction loop

```text
EVENT
-> AVOT AWAKEN
-> SIGNAL PACKET
-> LOCAL_ONLY INFERENCE REQUEST
-> LOOPBACK RUNTIME
-> VALIDATED INFERENCE RETURN
-> EVIDENCE CONTINUITY
-> CIT MONITOR COUNCIL HANDOFF
-> DORMANCY
```

## Authority law

Pilot 02 must preserve all of the following:

```text
perception != authority
inference != authority
analysis_return != admission
council_handoff != approval
no Work is created
no execution is authorized
no institutional memory is mutated
```

The conduction layer therefore forces:

- inference `privacy_boundary = local_only`
- inference `authority_posture = analysis_only`
- `work_ref = null`
- inference `authority_effect = analysis_return`
- council handoff `institutional_effect = none`

## Evidence continuity

A material conduction must preserve a reconstructable chain:

```text
source evidence
-> monitor signal id
-> inference request id
-> runtime/model provenance
-> inference evidence refs
-> monitor evidence return
-> council handoff
```

A no-material-change observation does not recruit inference and returns directly to dormancy.

## Non-goals

This pilot does not implement:

- network monitoring;
- scheduler infrastructure;
- remote/cloud inference;
- Work participant activation;
- Admission;
- Fabricator execution;
- Notion mutation;
- Continuum memory promotion;
- multi-participant deliberation;
- autonomous routing.

## Graduation criterion

Pilot 02 graduates when CI proves both paths:

1. material signal -> local inference -> evidence-bearing council handoff;
2. no material change -> no inference -> clean dormancy.

The first path must preserve local-only privacy and analysis-only authority from perception through return.
