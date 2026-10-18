/**
 * Pure legacy normalization derived from CONTROL-CENTER-HANDOFF-001.
 * No transport, I/O, credentials, ledger, or receiver-completion authority.
 * See docs/CONTROL_CENTER_HANDOFF_INTEGRATION_001.md for integration differences.
 */
import { createHash } from 'node:crypto';

export const NORMALIZATION_VERSION = 'ccc-legacy-normalization/1';
const CONTROL_CENTER = 'sovereign-codex/Codex-control-center';
const ENGINE_REPO = 'sovereign-codex/AVOT-engine';
const ENGINE_TARGET = 'avot-engine-runner';
const INTERNAL_STAGE = 'cross-repo-dispatcher';
const INTERNAL_EVENT = 'engine_handoff';
const FINAL_EVENT = 'avot_execution';
const has = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
export const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function equal(a, b) { return stable(a) === stable(b); }

// JSON.parse validates syntax first. This token walk then rejects duplicate
// decoded keys, including escaped equivalents, at every object depth.
export function strictJson(raw) {
  const value = JSON.parse(raw);
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [];
  const stack = [];
  for (const token of tokens) {
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? { type: 'object', keys: new Set(), keyNext: true } : { type: 'array' });
      if (stack.length > 64) {
        const error = new Error('JSON nesting exceeds the 64-level integration limit.');
        error.code = 'json_nesting_limit';
        throw error;
      }
    }
    else if (token === '}' || token === ']') stack.pop();
    else {
      const frame = stack.at(-1);
      if (token === ',' && frame?.type === 'object') frame.keyNext = true;
      else if (token.startsWith('"') && frame?.type === 'object' && frame.keyNext) {
        const key = JSON.parse(token);
        if (frame.keys.has(key)) {
          const error = new Error(`Duplicate JSON key: ${key}`);
          error.code = 'duplicate_json_key';
          throw error;
        }
        frame.keys.add(key);
        frame.keyNext = false;
      }
    }
  }
  const checkNumbers = item => {
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
      const error = new Error('This input profile rejects non-finite and unsafe integer JSON numbers.');
      error.code = 'unsupported_json_number';
      throw error;
    }
    if (item && typeof item === 'object') Object.values(item).forEach(checkNumbers);
  };
  checkNumbers(value);
  return value;
}

export function validTimestamp(value) {
  if (!text(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone === '-00:00') return false; // RFC3339 unknown offset is not a known producer timezone.
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

const PROGRESS = new Set([
  'started', 'start', 'received', 'normalized', 'decision_created',
  'route_selected', 'routed', 'route', 'dispatched', 'dispatch',
  'execution_started', 'result_sent', 'sent', 'result_received', 'result',
  'result_stored', 'stored', 'trace_stored'
]);
const COMPLETION = new Set(['success', 'complete', 'completed', 'execution_completed']);

export function classifyStatus(raw) {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  let category = 'unknown';
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  // Negative tokens are checked before exact positive labels. No positive
  // substring can create a progress or completion classification.
  if (tokens.some(token => ['fail', 'failed', 'failure', 'error', 'errored'].includes(token))) category = 'failure';
  else if (tokens.includes('incomplete')) category = 'incomplete';
  else if (tokens.includes('partial')) category = 'partial';
  else if (tokens.includes('skipped')) category = 'skipped';
  else if (tokens.some(token => ['blocked', 'cancelled', 'canceled'].includes(token)) || ['no_route', 'no_route_found'].includes(normalized)) category = 'blocked';
  else if (tokens.includes('unknown')) category = 'unknown';
  else if (PROGRESS.has(normalized)) category = 'progress';
  else if (COMPLETION.has(normalized)) category = 'reported_completion';
  return { raw: raw === undefined ? null : clone(raw), normalized, category, producer_claim_only: true };
}

export function normalizeHandoff(input = {}) {
  const issues = [];
  const issue = (code, message, observed = null) => issues.push({ code, message, observed });
  if (!object(input)) {
    issue('invalid_input', 'The normalizer input must be an object.');
    input = {};
  }
  let routeDecision;
  try { routeDecision = clone(input.routeDecision); }
  catch { routeDecision = null; issue('invalid_route_decision', 'Route decision must be JSON data.'); }
  const rawJson = typeof input.rawJson === 'string' ? input.rawJson : null;
  const losslessUtf8 = rawJson !== null && rawJson.isWellFormed();
  const result = {
    contract_version: NORMALIZATION_VERSION,
    standing: 'workflow_preparation',
    disposition: 'hold',
    issues,
    event: null,
    producer_outcome: classifyStatus(undefined),
    provenance: {
      request_id: text(input.requestId) ? input.requestId : null,
      declared_source_repo: null,
      declared_source_workflow: null,
      trace_id: null,
      authenticated: false,
      request_id_origin: 'caller_supplied_workflow_request'
    },
    routing: null,
    request: null,
    evidence: {
      raw_json: rawJson,
      raw_sha256: losslessUtf8 ? sha256(rawJson) : null,
      normalized_event_sha256: null,
      route_decision: routeDecision,
      route_decision_sha256: sha256(stable(routeDecision)),
      ingress_event_type: input.ingressEventType ?? null,
      source_event_origin: null
    }
  };
  if (!text(input.requestId)) issue('missing_request_id', 'A caller-supplied request ID is required.');
  if (input.ingressEventType !== 'route-event') issue('unsupported_ingress', 'This integration admits the existing route-event ingress only.', input.ingressEventType ?? null);
  if (rawJson === null) { issue('invalid_json', 'rawJson must be a JSON string.'); return result; }
  if (!losslessUtf8) { issue('invalid_unicode', 'Literal unpaired surrogates are not losslessly representable as UTF-8 input bytes.'); return result; }
  let envelope;
  try { envelope = strictJson(rawJson); }
  catch (error) { issue(error.code || 'invalid_json', error.message); return result; }
  if (!object(envelope)) { issue('invalid_envelope', 'The JSON root must be an object.'); return result; }
  const nested = has(envelope, 'event');
  if (nested && !object(envelope.event)) { issue('invalid_event', 'An event wrapper must contain an object.'); return result; }
  const suppliedEvent = nested ? envelope.event : envelope;
  const event = clone(suppliedEvent);
  delete event.target; // Control field moves to the normalized wrapper; raw bytes remain preserved.
  result.event = event;

  function declarations(keys) {
    const found = [];
    for (const key of keys) {
      if (has(suppliedEvent, key)) found.push({ field: `${nested ? 'event.' : ''}${key}`, value: suppliedEvent[key], producer: true });
      if (nested && has(envelope, key)) found.push({ field: key, value: envelope[key], producer: false });
    }
    return found;
  }
  function producerField(name, aliases = [name], required = true) {
    const found = declarations(aliases);
    const producer = found.filter(item => item.producer);
    if (!producer.length) {
      if (required) issue(`missing_${name}`, `Producer ${name} is required; wrapper or local diagnostic values cannot replace it.`, found);
      return null;
    }
    if (found.some(item => !text(item.value))) {
      issue(`invalid_${name}`, `Every declared ${name} must be a nonempty, unpadded string.`, found);
      return null;
    }
    if (found.some(item => item.value !== producer[0].value)) {
      issue(`conflicting_${name}`, `Conflicting producer ${name} declarations.`, found);
      return null;
    }
    return producer[0].value;
  }

  const traceId = producerField('trace_id');
  const sourceRepo = producerField('source_repo', ['repo', 'source_repo']);
  const sourceWorkflow = producerField('source_workflow', ['workflow', 'source_workflow']);
  const status = producerField('status');
  const timestamp = producerField('timestamp');
  const sourceEvent = producerField('source_event', ['source_event'], false);
  for (const claim of declarations(['source'])) {
    if (!text(claim.value) || claim.value !== sourceRepo) issue('conflicting_source', 'Legacy source must agree with the admitted producer repository; it cannot replace missing repo provenance.', claim);
  }
  result.provenance.trace_id = traceId;
  result.provenance.declared_source_repo = sourceRepo;
  result.provenance.declared_source_workflow = sourceWorkflow;
  if (sourceRepo !== null) { event.repo = sourceRepo; event.source_repo = sourceRepo; }
  if (sourceWorkflow !== null) { event.workflow = sourceWorkflow; event.source_workflow = sourceWorkflow; }
  const sourceEventClaims = declarations(['source_event']);
  if (sourceEvent !== null) {
    event.source_event = sourceEvent;
    result.evidence.source_event_origin = 'producer_declared';
  } else if (sourceEventClaims.length === 0) {
    event.source_event = 'legacy';
    result.evidence.source_event_origin = 'legacy_profile_annotation';
  } else {
    result.evidence.source_event_origin = 'unresolved_declaration';
    if (!has(suppliedEvent, 'source_event')) issue('misplaced_source_event', 'Wrapper source_event cannot substitute for a producer declaration inside event.', sourceEventClaims);
  }
  if (timestamp !== null && !validTimestamp(timestamp)) issue('invalid_timestamp', 'Producer timestamp must be a real RFC3339 date with a known explicit timezone.', timestamp);
  result.producer_outcome = classifyStatus(suppliedEvent.status);
  if (status !== null && !['progress', 'reported_completion'].includes(result.producer_outcome.category)) {
    issue('producer_outcome_hold', 'Producer outcome cannot advance this handoff.', result.producer_outcome);
  }

  // Rich wrapper fields are preserved on the wrapper and normalized into event.
  // Contradictory double declarations are held, never resolved by precedence.
  for (const key of ['payload', 'governance', 'runtime_packet']) {
    const found = declarations([key]);
    if (found.some(item => !object(item.value))) issue(`invalid_${key}`, `${key} must be an object when supplied.`, found);
    if (found.length > 1 && found.some(item => !equal(item.value, found[0].value))) issue(`conflicting_${key}`, `Conflicting ${key} declarations.`, found);
    if (!has(event, key) && nested && has(envelope, key)) event[key] = clone(envelope[key]);
  }

  const targets = declarations(['target']);
  const suppliedTargets = targets.map(item => item.value);
  if (!targets.length) issue('missing_target', 'An explicit final destination label is required; the route decision cannot invent it.');
  if (targets.some(item => !text(item.value))) issue('invalid_target', 'Destination labels must be nonempty strings.', targets);
  if (targets.length > 1 && targets.some(item => item.value !== targets[0].value)) issue('conflicting_target', 'Conflicting wrapper and event destination labels.', targets);
  const routeValid = object(routeDecision) && ['stage', 'target', 'targetRepo', 'receivingEventType'].every(key => text(routeDecision[key]));
  if (!routeValid) issue('invalid_route_decision', 'The explicit stage, target, targetRepo and receivingEventType are required.', routeDecision);
  if (routeValid) {
    result.routing = {
      next_stage: routeDecision.stage,
      internal_event_type: INTERNAL_EVENT,
      immediate_repository: CONTROL_CENTER,
      destination: {
        target: routeDecision.target,
        repository: routeDecision.targetRepo,
        event_type: routeDecision.receivingEventType,
        standing: 'declared_destination',
        live_receiver_verified: false
      }
    };
    if (routeDecision.stage !== INTERNAL_STAGE) issue('unsupported_stage', 'Only the internal Dispatcher stage is in this integration.', routeDecision.stage);
    if (targets.some(item => item.value !== routeDecision.target)) issue('conflicting_target', 'The route decision contradicts an explicit destination.', { supplied: targets, decision: routeDecision.target });
  }
  const destinationClaims = [
    ...declarations(['target_repo']).map(item => ({ ...item, expected: routeDecision?.targetRepo })),
    ...declarations(['target_stage']).map(item => ({ ...item, expected: FINAL_EVENT })),
    ...declarations(['receiving_event_type']).map(item => ({ ...item, expected: routeDecision?.receivingEventType }))
  ];
  for (const [prefix, container] of nested ? [['event.', suppliedEvent], ['', envelope]] : [['', envelope]]) {
    if (has(container, 'destination')) {
      if (!object(container.destination)) issue('invalid_destination', 'destination must be an object.', container.destination);
      else {
        if (has(container.destination, 'repo')) destinationClaims.push({ field: `${prefix}destination.repo`, value: container.destination.repo, expected: routeDecision?.targetRepo });
        if (has(container.destination, 'event_type')) destinationClaims.push({ field: `${prefix}destination.event_type`, value: container.destination.event_type, expected: routeDecision?.receivingEventType });
        for (const key of ['workflow', 'avot']) {
          if (has(container.destination, key) && container.destination[key] !== null) issue('unsupported_destination_selector', 'A non-null workflow or AVOT destination selector needs a separately reviewed meaning.', { field: `${prefix}destination.${key}`, value: container.destination[key] });
        }
      }
    }
  }
  for (const claim of destinationClaims) {
    if (!text(claim.value) || claim.value !== claim.expected) issue('conflicting_destination', 'Explicit destination context contradicts the selected route.', claim);
  }
  const tymeSelected = [...suppliedTargets, routeDecision?.target, routeDecision?.targetRepo, ...destinationClaims.map(item => item.value)]
    .some(value => typeof value === 'string' && /^(?:sovereign-codex\/)?tyme-lab$/i.test(value));
  if (tymeSelected) issue('missing_receiver', 'Tyme-Lab has no declared receiver contract in the reviewed workflow set.');
  else if (routeValid && (routeDecision.target !== ENGINE_TARGET || routeDecision.targetRepo !== ENGINE_REPO || routeDecision.receivingEventType !== FINAL_EVENT)) {
    issue('unreviewed_destination', 'Only the explicit AVOT-engine destination is admitted; receiver compatibility is checked separately.', routeDecision);
  }

  if (routeValid && !issues.some(item => ['conflicting_target', 'conflicting_destination', 'missing_target', 'invalid_target', 'unreviewed_destination', 'missing_receiver'].includes(item.code))) {
    if (!has(event, 'target_repo')) event.target_repo = routeDecision.targetRepo;
    if (!has(event, 'target_stage')) event.target_stage = FINAL_EVENT;
    if (!has(event, 'receiving_event_type')) event.receiving_event_type = routeDecision.receivingEventType;
  }
  result.evidence.normalized_event_sha256 = sha256(stable(event));
  if (issues.length === 0) {
    const wrapper = nested ? clone(envelope) : {};
    wrapper.target = routeDecision.target;
    wrapper.event = event;
    result.request = {
      repository: CONTROL_CENTER,
      body: { event_type: INTERNAL_EVENT, client_payload: wrapper }
    };
    result.disposition = 'ready';
  }
  return result;
}

