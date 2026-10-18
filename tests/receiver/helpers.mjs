import assert from 'node:assert/strict';
import {
  prepareHandoff, digest as cccDigest, recordBytes as cccRecordBytes,
  gitBlobSha as cccBlobSha
} from './fixtures/ccc-v1/contract.mjs';
import { executeHandoff } from './fixtures/ccc-v1/executor.mjs';
import { prepareReceiver, ENGINE_REPO, CONTROL_CENTER } from '../../scripts/receiver/contract.mjs';
import { recordBytes, gitBlobSha } from '../../scripts/receiver/encoding.mjs';

export const clone = value => structuredClone(value);
export const FIXTURE_SOURCE_SHA256 = 'e'.repeat(64);

export function cccPolicy() {
  return {
    schema_version: 'ccc-handoff-policy/1', enabled: true, ledger_branch: 'main',
    producer_bindings: [{ sender_id: '101', source_repo: 'org/producer', source_workflow: 'dispatch-workflow' }],
    dispatcher_sender_ids: ['202'],
    receiver: {
      repository: ENGINE_REPO, event_type: 'avot_execution', compatible: true,
      verified_commit: 'd'.repeat(40), evidence_ref: 'fixture-only:portable-receiver-compatibility'
    }
  };
}

export function receiverPolicy(upstream = cccPolicy()) {
  return {
    schema_version: 'avot-receiver-policy/1', enabled: true, ledger_branch: 'main',
    allowed_dispatch_sender_ids: ['303'], upstream_policy_sha256: cccDigest(upstream),
    receiver_source_sha256: FIXTURE_SOURCE_SHA256
  };
}

export function producerPayload(overrides = {}) {
  return {
    request_id: 'portable-request-001', target: 'avot-engine-runner',
    event: {
      trace_id: 'portable-trace-001', repo: 'org/producer', workflow: 'dispatch-workflow',
      status: 'received', timestamp: '2026-10-17T22:30:00-07:00',
      payload: { message: 'preserve all content', numbers: [1, 2, 3] },
      governance: { posture: 'review', execution_authorized: false },
      runtime_packet: { packet_id: 'packet-portable-001', execution_state: 'received' },
      extension: { a: { b: [false, null, 'nested'] } }
    },
    wrapper_note: { owner: 'declared producer', preserve: true },
    ...overrides
  };
}

function cccObservation(overrides = {}) {
  return {
    eventName: 'repository_dispatch', repository: CONTROL_CENTER,
    runId: '7001', runAttempt: '1', observedAt: '2026-10-18T05:31:00.000Z', ...overrides
  };
}

export function receiverObservation(overrides = {}) {
  return {
    eventName: 'repository_dispatch', repository: ENGINE_REPO, ref: 'refs/heads/main',
    runId: '9001', runAttempt: '1', observedAt: '2026-10-18T05:55:00.000Z',
    commitSha: 'a'.repeat(40), workflowSha: 'a'.repeat(40), checkoutSha: 'a'.repeat(40),
    workflowRef: ENGINE_REPO + '/.github/workflows/avot-engine-receiver.yml@refs/heads/main',
    receiverSourceSha256: FIXTURE_SOURCE_SHA256, ...overrides
  };
}

export function receiverEvent(envelope, { senderId = 303, overrides = {} } = {}) {
  return {
    action: 'avot_execution', repository: { full_name: ENGINE_REPO },
    sender: { id: senderId }, client_payload: clone(envelope), ...overrides
  };
}

export function prepare(chain, { envelope = chain.envelope, policy = receiverPolicy(chain.cccPolicy), obs = receiverObservation(), senderId = 303, event, bytes } = {}) {
  return prepareReceiver({
    eventBytes: bytes ?? Buffer.from(JSON.stringify(event ?? receiverEvent(envelope, { senderId }))),
    observation: obs, policy
  });
}

export function ready(value) {
  assert.equal(value.disposition, 'ready', JSON.stringify(value.issues));
  assert.match(value.identity.key, /^[0-9a-f]{64}$/);
  assert.match(value.binding.fingerprint, /^[0-9a-f]{64}$/);
  assertUnverified(value);
  return value;
}

export function assertUnverified(value) {
  assert.equal(value.execution.status, 'unverified');
  assert.equal(value.execution.completion_claim, false);
}

// CCC and AVOT storage are independent namespaces. All successful writes are
// create-only; a shared map persists records across separately prepared runs.
export class LedgerHarness {
  constructor({ receiptReply, readReceiptReply, raceReceipts = 0 } = {}) {
    this.cccRecords = new Map(); this.receipts = new Map();
    this.cccCalls = []; this.receiverCalls = [];
    this.receiptReply = receiptReply; this.readReceiptReply = readReceiptReply;
    this.raceReceipts = raceReceipts; this.waitingReceipts = 0;
    if (raceReceipts) this.receiptGate = new Promise(resolve => { this.openReceiptGate = resolve; });
    this.cccService = {
      createRecord: async (path, record) => {
        this.cccCalls.push({ kind: 'createRecord', path, record: clone(record) });
        if (this.cccRecords.has(path)) return { status: 409, blobSha: null };
        const stored = { record: clone(record), blobSha: cccBlobSha(cccRecordBytes(record)) };
        this.cccRecords.set(path, stored);
        return { status: 201, blobSha: stored.blobSha };
      },
      readRecord: async path => {
        this.cccCalls.push({ kind: 'readRecord', path });
        const stored = this.cccRecords.get(path);
        return stored ? { status: 200, ...clone(stored) } : { status: 404, record: null, blobSha: null };
      },
      dispatch: async request => {
        this.cccCalls.push({ kind: 'dispatch', request: clone(request) });
        return { status: 204 };
      }
    };
    this.receiverService = {
      readClaim: async path => {
        this.receiverCalls.push({ kind: 'readClaim', path });
        const stored = this.cccRecords.get(path);
        return stored ? { status: 200, ...clone(stored) } : { status: 404, record: null, blobSha: null };
      },
      readReceipt: async path => {
        this.receiverCalls.push({ kind: 'readReceipt', path });
        if (this.readReceiptReply instanceof Error) throw this.readReceiptReply;
        if (this.readReceiptReply) return clone(this.readReceiptReply);
        const stored = this.receipts.get(path);
        return stored ? { status: 200, ...clone(stored) } : { status: 404, record: null, blobSha: null };
      },
      createReceipt: async (path, record) => {
        this.receiverCalls.push({ kind: 'createReceipt', path, record: clone(record) });
        if (this.raceReceipts && this.waitingReceipts < this.raceReceipts) {
          this.waitingReceipts += 1;
          if (this.waitingReceipts === this.raceReceipts) this.openReceiptGate();
          await this.receiptGate;
        }
        if (this.receiptReply instanceof Error) throw this.receiptReply;
        if (this.receiptReply && this.receiptReply.status !== 201) return clone(this.receiptReply);
        if (this.receipts.has(path)) return { status: 409, blobSha: null };
        const stored = { record: clone(record), blobSha: gitBlobSha(recordBytes(record)) };
        this.receipts.set(path, stored);
        return this.receiptReply ? clone(this.receiptReply) : { status: 201, blobSha: stored.blobSha, commitSha: 'c'.repeat(40) };
      }
    };
  }
}

export async function buildChain({ payload = producerPayload(), policy = cccPolicy(), harness = new LedgerHarness() } = {}) {
  const router = prepareHandoff({
    stage: 'router', policy, observation: cccObservation(),
    eventBytes: Buffer.from(JSON.stringify({ action: 'route-event', repository: { full_name: CONTROL_CENTER }, sender: { id: 101 }, client_payload: payload }))
  });
  ready(router);
  const routed = await executeHandoff(router, harness.cccService);
  assert.equal(routed.disposition, 'transport_accepted', JSON.stringify(routed.issues));
  const dispatcher = prepareHandoff({
    stage: 'dispatcher', policy, observation: cccObservation({ runId: '8001', observedAt: '2026-10-18T05:32:00.000Z' }),
    eventBytes: Buffer.from(JSON.stringify({ action: 'engine_handoff', repository: { full_name: CONTROL_CENTER }, sender: { id: 202 }, client_payload: router.request.body.client_payload }))
  });
  ready(dispatcher);
  const dispatched = await executeHandoff(dispatcher, harness.cccService);
  assert.equal(dispatched.disposition, 'transport_accepted', JSON.stringify(dispatched.issues));
  return { harness, router, dispatcher, envelope: clone(dispatcher.request.body.client_payload), cccPolicy: policy, payload: clone(payload) };
}
