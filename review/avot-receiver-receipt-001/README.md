# AVOT receiver receipt verification

This directory records local verification of the [disabled receiver implementation](../../docs/AVOT_RECEIVER_RECEIPT_001.md).

| File | Purpose |
|---|---|
| [TEST_RESULTS.json](TEST_RESULTS.json) | Final run, test counts, source fingerprints, base identities and evidence limits. |
| [tests.tap](tests.tap) | Complete final Node test output. |
| [CLI_SMOKE.json](CLI_SMOKE.json) | Prepare and execute checked under the disabled policy with a forbidden-network guard. |
| [SHA256SUMS](SHA256SUMS) | Checksums of every changed file except this checksum manifest. Paths are repository-relative. |

Verify recorded files before editing:

```sh
sha256sum -c review/avot-receiver-receipt-001/SHA256SUMS
```

Reproduce on Node 24:

```sh
node --test --test-isolation=none --test-reporter=tap tests/receiver/*.test.mjs
```

The test fixture corpus contains only the exact normalization, contract and executor modules from Control Center PR #22, pinned by its [manifest](../../tests/receiver/fixtures/ccc-v1/MANIFEST.json). Production code does not import those fixtures. The tests execute real preparation/executor code using synthetic policies, observations and injected transport/ledger services.

These results establish local contract compatibility and the observed disabled CLI behavior. They do not establish live GitHub atomicity or credentials, an actual receiver dispatch, artifact upload, requested-work execution, or institutional acceptance. All production policy gates remain disabled/unpinned. Every resulting receipt keeps execution unverified.
