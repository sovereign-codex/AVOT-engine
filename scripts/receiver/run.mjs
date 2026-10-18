/** Actions entry point: receiver observations are data, never shell arguments. */
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { RECEIVER_VERSION, RECEIVER_SOURCE_PATHS, receiverSourceFingerprint, prepareReceiver } from './contract.mjs';
import { strictJson, hashBytes, recordBytes, gitBlobSha } from './encoding.mjs';
import { executeReceiver } from './executor.mjs';
import { createGithubService } from './github-service.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [command, ...extra] = process.argv.slice(2);
if (!['prepare', 'execute'].includes(command) || extra.length) {
  console.error('Usage: node scripts/receiver/run.mjs prepare|execute');
  process.exitCode = 1;
} else {
  const stateDir = join(root, '.receiver-state');
  const observation = {
    eventName: process.env.GITHUB_EVENT_NAME ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    ref: process.env.GITHUB_REF ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    observedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA ?? null,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA ?? null,
    checkoutSha: null,
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    receiverSourceSha256: null
  };
  let eventBytes;
  let prepared;
  let result;
  let ready = false;
  let executionStarted = false;
  const save = async (name, bytes) => {
    const path = join(stateDir, name);
    await writeFile(path, bytes, { mode: 0o600 });
    await chmod(path, 0o600);
  };
  const report = async (name, value) => save(name, recordBytes(value));

  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (typeof eventPath !== 'string' || !eventPath) throw new Error('Event path unavailable.');
    eventBytes = await readFile(eventPath);
    await save('actions-event.json', eventBytes);
    const policyBytes = await readFile(join(root, 'config', 'avot-receiver.json'));
    const policy = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(policyBytes));
    const sourceEntries = [];
    for (const path of RECEIVER_SOURCE_PATHS) {
      sourceEntries.push({ path, sha256: hashBytes(await readFile(join(root, path))) });
    }
    observation.receiverSourceSha256 = receiverSourceFingerprint(sourceEntries);
    try {
      const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], {
        cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 4_096
      });
      const sha = stdout.trim();
      if (/^[a-f0-9]{40}$/.test(sha)) observation.checkoutSha = sha;
    } catch {
      // Missing Git metadata stays unknown and must fail contract validation.
    }
    prepared = prepareReceiver({ eventBytes, observation, policy });
    ready = prepared.disposition === 'ready';
    await report('prepared.json', prepared);
    result = prepared;

    if (command === 'execute' && ready) {
      // Never load an earlier preparation artifact as execution authority.
      const service = createGithubService({
        claimReadToken: process.env.CCC_CLAIM_READ_TOKEN,
        receiptWriteToken: process.env.GITHUB_TOKEN
      });
      executionStarted = true;
      result = await executeReceiver(prepared, service);
      ready = ['receipt_recorded', 'duplicate'].includes(result.disposition);
    }
  } catch {
    result = {
      ...(prepared ?? {
        contract_version: RECEIVER_VERSION,
        identity: null,
        binding: null,
        envelope: null,
        observation,
        evidence: eventBytes ? { actions_event_file_sha256: hashBytes(eventBytes) } : {},
        execution: { status: 'unverified', completion_claim: false }
      }),
      disposition: executionStarted ? 'receipt_uncertain' : 'hold',
      issues: [...(prepared?.issues ?? []), {
        code: executionStarted ? 'receipt_unverified_error' : 'preparation_or_credentials_unavailable',
        message: executionStarted
          ? 'Receipt processing stopped without a verifiable result; no automatic retry is allowed.'
          : 'The event, policy, runtime observations, local evidence, or required credentials could not be validated.'
      }],
      receipt: null,
      persistence: {
        status: executionStarted ? 'unverified' : 'not_attempted',
        path: null, blob_sha: null, commit_sha: null,
        custody: 'repository_writers_must_preserve_receipts'
      }
    };
    ready = false;
  }

  try {
    await report('prepared.json', prepared ?? result);
    await report('result.json', result);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready ? 'true' : 'false'}\n`);
    }
  } catch {
    console.error('AVOT receiver evidence could not be persisted.');
    process.exitCode = 1;
  }
  console.log(`AVOT receiver: ${result.disposition}; execution unverified.`);
  let verifiedReceipt = false;
  try {
    verifiedReceipt = result.receipt !== null && result.receipt !== undefined &&
      /^[a-f0-9]{40}$/.test(result.persistence?.blob_sha ?? '') &&
      gitBlobSha(recordBytes(result.receipt)) === result.persistence.blob_sha;
  } catch {
    // An unverifiable result can never make the workflow successful.
  }
  const succeeded = command === 'prepare' ? ready : verifiedReceipt && (
    (result.disposition === 'receipt_recorded' && result.persistence.status === 'recorded') ||
    (result.disposition === 'duplicate' && result.persistence.status === 'existing')
  );
  if (!succeeded) process.exitCode = 1;
}
