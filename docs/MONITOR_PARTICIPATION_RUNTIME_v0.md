# Monitor Participation Runtime v0

## Canonical contract source

This runtime consumes the bounded monitor participation semantics graduated in:

- repository: `sovereign-codex/Tyme-Lab`
- canonical merge commit: `ce995ee788cbbbacbc658190759c33d9c565a8ff`
- contract family: `monitor-manifest.v0.1`, `signal-packet.v0.1`, `routing-decision.v0.1`, `evidence-return.v0.1`

This repository does not redefine those authority semantics.

## Runtime proof

`src/runtime/monitor.ts` implements a deterministic synthetic activation cycle for one bounded monitor participant.

The proof exercises:

```text
DORMANT
-> AWAKEN
-> BIND CONTEXT
-> SENSE
-> INTERPRET
-> SIGNAL OR NO-MATERIAL-CHANGE
-> RETURN EVIDENCE
-> DORMANT
```

The runtime must remain consequence-free:

- `authority_posture = analysis_only`
- `institutional_effect = none`
- no Work creation
- no execution authorization
- no merge
- no Canon promotion
- no institutional-memory mutation

A material signal may recommend handoff to `cit-monitor-council`; it cannot perform Admission or execution.

## Deliberate separation from the general graph executor

The existing graph executor currently performs a stub memory write during execution. Monitor participation is intentionally implemented beside that executor rather than inside it so a sensing activation cannot accidentally inherit memory mutation or broader execution behavior.

## Current limitations

This branch does not implement:

- network polling;
- schedule execution;
- LLM-backed interpretation;
- Notion writes;
- GitHub mutation;
- Fabricator invocation;
- Work participant activation;
- routing-decision execution;
- CIT UI.

The runtime proof is deterministic and synthetic by design.
