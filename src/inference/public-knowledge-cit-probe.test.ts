import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import {
  PUBLIC_SOURCE_REF,
  PROBE_ID,
  buildPublicKnowledgeProbeRequest,
  evaluateCitReturn,
  runPublicCitProbe,
  validateApprovedPublicSource,
} from "./public-knowledge-cit-probe.js";

const sourceUrl = new URL("../../inputs/cit-probe/AGI-0001.publication.json", import.meta.url);
const fixture = await readFile(sourceUrl);

function safeReturn(model = "fixture-model") {
  return {
    cit_version: "0.1",
    envelope_type: "CIT-RETURN",
    source: { intelligence: "local-openai-compatible", model_or_agent: model, session_or_run_ref: null },
    handled: { originating_intent: "KNOW", result_type: "analysis" },
    result: {
      summary: "No. Publication 001 is approved public inheritance, not autonomous governance authority.",
      evidence_refs: [PUBLIC_SOURCE_REF],
      assumptions: [],
      uncertainty: [],
    },
    standing: { claimed_by_intelligence: "none", requested_hall_standing: "none", canon_claimed: false },
    consequence: { action_taken: false, hall_receipt_claimed: false, authorization_claimed: false },
    routing: { suggested_next_mode: "KNOW", reason: "Inspect public provenance." },
    contribution: { candidate: false, requires_distinct_submission_action: true },
  };
}

async function withSyntheticCompletion(
  content: string,
  run: (baseUrl: string) => Promise<void>,
  emitId = true,
) {
  const server = createServer((incoming, response) => {
    if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }
    incoming.resume();
    incoming.on("end", () => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        ...(emitId ? { id: "synthetic-completion-001" } : {}),
        model: "fixture-model",
        choices: [{ message: { role: "assistant", content } }],
      }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  }
}

test("approved public JSON fixture verifies its pinned Git blob and invariants", () => {
  const approved = validateApprovedPublicSource(fixture);
  assert.equal(approved.selected_document.scroll.scroll_id, "AGI-0001");
  assert.equal(approved.selected_document.authority.system_self_authorizing, false);
  assert.match(approved.sha256, /^[a-f0-9]{64}$/);
});

test("rejects one changed source byte before model invocation", () => {
  const tampered = Buffer.from(fixture);
  tampered[10] ^= 1;
  assert.throws(() => validateApprovedPublicSource(tampered), /do not match approved pinned Git blob/);
});

test("candidate request retains local-only, no-authority, no Work identity", () => {
  const request = buildPublicKnowledgeProbeRequest(
    validateApprovedPublicSource(fixture), "test-public-001", "fixture-model",
  );
  assert.equal(request.privacy_boundary, "local_only");
  assert.equal(request.authority_posture, "none");
  assert.equal(request.work_ref, null);
  assert.deepEqual(request.context_refs, [PUBLIC_SOURCE_REF]);
  assert.equal(request.participant_id, undefined);
});

test("strict, bounded CIT-RETURN validates structurally without claiming grounding certification", () => {
  const assessment = evaluateCitReturn(JSON.stringify(safeReturn()), "fixture-model");
  assert.deepEqual(assessment.errors, []);
  assert.ok(assessment.parsed_return);
});

test("forged Hall receipt, Canon claim and extra evidence source fail closed", () => {
  const bad = safeReturn();
  bad.consequence.hall_receipt_claimed = true;
  bad.standing.canon_claimed = true;
  bad.result.evidence_refs.push("https://private.example/hidden");
  const assessment = evaluateCitReturn(JSON.stringify(bad), "fixture-model");
  assert.ok(assessment.errors.some(e => e.includes("Hall receipt")));
  assert.ok(assessment.errors.some(e => e.includes("Canon")));
  assert.ok(assessment.errors.some(e => e.includes("allowlisted")));
});

test("rejects non-JSON model return rather than promoting template prose", () => {
  const a = evaluateCitReturn("Sure, I governed the Hall!", "fixture-model");
  assert.equal(a.parsed_return, null);
  assert.equal(a.errors.length, 1);
});

test("synthetic loopback adapter carries source and TRACE without release certification", async () => {
  await withSyntheticCompletion(JSON.stringify(safeReturn()), async baseUrl => {
    const returned = await runPublicCitProbe({
      source_bytes: fixture,
      base_url: baseUrl,
      model: "fixture-model",
      request_id: "synthetic-cit-001",
      execution_kind: "synthetic_fixture",
    });
    assert.equal(returned.probe_id, PROBE_ID);
    assert.equal(returned.run_kind, "synthetic_fixture");
    assert.equal(returned.inference_status, "completed");
    assert.equal(returned.authority_effect, "none");
    assert.equal(returned.envelope_valid, true);
    assert.deepEqual(returned.evidence_refs, ["completion:synthetic-completion-001"]);
    assert.equal(returned.grounding_review, "PENDING_INDEPENDENT_REVIEW");
    assert.equal(returned.live_deployment_verified, false);
    assert.equal(returned.release_gate_G2, "OPEN");
  });
});

test("synthetic runtime with forged consequence returns explicit envelope failure", async () => {
  const forged = safeReturn();
  forged.consequence.authorization_claimed = true;
  await withSyntheticCompletion(JSON.stringify(forged), async baseUrl => {
    const result = await runPublicCitProbe({
      source_bytes: fixture,
      base_url: baseUrl,
      model: "fixture-model",
      execution_kind: "synthetic_fixture",
    });
    assert.equal(result.envelope_valid, false);
    assert.equal(result.release_gate_G2, "OPEN");
  });
});

test("existing evidence-required adapter rejects runtime without completion ID", async () => {
  await withSyntheticCompletion(JSON.stringify(safeReturn()), async baseUrl => {
    await assert.rejects(
      runPublicCitProbe({ source_bytes: fixture, base_url: baseUrl, model: "fixture-model" }),
      /no recoverable completion identifier/,
    );
  }, false);
});

test("remote model endpoint cannot satisfy local-only probe even if configured", async () => {
  await assert.rejects(
    runPublicCitProbe({
      source_bytes: fixture,
      base_url: "https://external-provider.example/api",
      model: "fixture-model",
    }),
    /requires a loopback endpoint/,
  );
});
