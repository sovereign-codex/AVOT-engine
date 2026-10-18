/** Fixed Contents API boundary for upstream claim reads and AVOT receipt custody. */
import { CONTROL_CENTER, ENGINE_REPO } from './contract.mjs';
import { strictJson, recordBytes, gitBlobSha } from './encoding.mjs';

const API = 'https://api.github.com';
const CLAIM_PATH = /^handoff-ledger\/v1\/(router|dispatcher)\/[a-f0-9]{64}\/claim\.json$/;
const RECEIPT_PATH = /^receiver-receipts\/v1\/[a-f0-9]{64}\/receipt\.json$/;
const BLOB_SHA = /^[a-f0-9]{40}$/;
const TIMEOUT_MS = 15_000;
const MAX_RECORD_BYTES = 1_000_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function tokenValid(token) {
  return typeof token === 'string' && /^[\x21-\x7e]{1,8192}$/.test(token);
}

function claimUrl(path) {
  if (typeof path !== 'string' || !CLAIM_PATH.test(path)) fail('Invalid upstream claim path.');
  return `${API}/repos/${CONTROL_CENTER}/contents/${path}`;
}

function receiptUrl(path) {
  if (typeof path !== 'string' || !RECEIPT_PATH.test(path)) fail('Invalid AVOT receipt path.');
  return `${API}/repos/${ENGINE_REPO}/contents/${path}`;
}

function strictUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeBase64(content) {
  if (typeof content !== 'string') fail('Invalid record content encoding.');
  const compact = content.replace(/\r?\n/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    fail('Invalid record content encoding.');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length > MAX_RECORD_BYTES || bytes.toString('base64') !== compact) {
    fail('Invalid record content encoding.');
  }
  return bytes;
}

export function createGithubService({ claimReadToken, receiptWriteToken, fetchImpl = globalThis.fetch } = {}) {
  if (!tokenValid(claimReadToken) || !tokenValid(receiptWriteToken) || typeof fetchImpl !== 'function') {
    fail('GitHub receiver credentials or transport are unavailable.');
  }

  async function call(url, method, token, body, inspect) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('GitHub request deadline exceeded.'));
      }, TIMEOUT_MS);
    });
    try {
      const operation = (async () => {
        const response = await fetchImpl(url, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2026-03-10',
            'Content-Type': 'application/json',
            'User-Agent': 'avot-receiver-receipt/1'
          },
          ...(body === undefined ? {} : { body }),
          redirect: 'error',
          signal: controller.signal
        });
        if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 ||
            response.redirected || (response.status >= 300 && response.status < 400)) {
          fail('Invalid or redirected GitHub response.');
        }
        try {
          return await inspect(response);
        } finally {
          if (response.body && !response.bodyUsed) await response.body.cancel();
        }
      })();
      return await Promise.race([operation, deadline]);
    } catch {
      // Keep tokens, request/response bodies and original exception text private.
      fail('GitHub receiver request could not be verified.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function json(response) {
    if (!response.body) fail('GitHub returned no record content.');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_000_000) {
          await reader.cancel();
          fail('GitHub response exceeded the record limit.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return strictJson(strictUtf8(Buffer.concat(chunks, length)));
  }

  async function read(url, path, token) {
    return call(`${url}?ref=main`, 'GET', token, undefined, async response => {
      if (response.status !== 200) return { status: response.status, blobSha: null, record: null };
      const result = await json(response);
      if (result?.type !== 'file' || result.encoding !== 'base64' || result.path !== path ||
          !BLOB_SHA.test(result.sha ?? '')) fail('Unverifiable record read response.');
      const bytes = decodeBase64(result.content);
      if (gitBlobSha(bytes) !== result.sha) fail('Record blob identity mismatch.');
      const record = strictJson(strictUtf8(bytes));
      if (!object(record) || !Buffer.from(recordBytes(record)).equals(bytes)) {
        fail('Stored record is not canonical.');
      }
      return { status: 200, blobSha: result.sha, record };
    });
  }

  return Object.freeze({
    async readClaim(path) {
      return read(claimUrl(path), path, claimReadToken);
    },

    async readReceipt(path) {
      return read(receiptUrl(path), path, receiptWriteToken);
    },

    async createReceipt(path, record) {
      const url = receiptUrl(path);
      let bytes;
      try {
        bytes = Buffer.from(recordBytes(record));
        if (!object(record) || bytes.length > MAX_RECORD_BYTES) fail('Invalid receiver record.');
        strictJson(strictUtf8(bytes));
      } catch {
        fail('Invalid receiver record.');
      }
      const expectedSha = gitBlobSha(bytes);
      const body = JSON.stringify({
        message: 'Record AVOT receiver receipt',
        branch: 'main',
        content: bytes.toString('base64')
        // No sha: this method may create a receipt and can never replace it.
      });
      return call(url, 'PUT', receiptWriteToken, body, async response => {
        if (response.status !== 201) return { status: response.status, blobSha: null };
        const result = await json(response);
        if (!BLOB_SHA.test(result?.content?.sha ?? '') || result.content.sha !== expectedSha) {
          fail('Unverifiable receipt creation response.');
        }
        return {
          status: 201,
          blobSha: expectedSha,
          ...(BLOB_SHA.test(result?.commit?.sha ?? '') ? { commitSha: result.commit.sha } : {})
        };
      });
    }
  });
}
