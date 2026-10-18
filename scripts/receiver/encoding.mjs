/** Strict JSON and canonical bytes shared by receiver preparation and persistence.
 * Canonicalization, JSON limits and timestamp rules match CCC handoff/1.
 */
import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => hashBytes(Buffer.from(canonical(value), 'utf8'));
export const recordBytes = value => Buffer.from(canonical(value) + '\n', 'utf8');
export const gitBlobSha = value => {
  const bytes = Buffer.from(value);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

export function strictJson(raw) {
  if (typeof raw !== 'string') throw new TypeError('Strict JSON requires text.');
  const value = JSON.parse(raw);
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [];
  const stack = [];
  for (const token of tokens) {
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? { type: 'object', keys: new Set(), keyNext: true } : { type: 'array' });
      if (stack.length > 64) {
        const error = new Error('JSON nesting exceeds the 64-level limit.');
        error.code = 'json_nesting_limit';
        throw error;
      }
    } else if (token === '}' || token === ']') stack.pop();
    else {
      const frame = stack.at(-1);
      if (token === ',' && frame?.type === 'object') frame.keyNext = true;
      else if (token.startsWith('"') && frame?.type === 'object' && frame.keyNext) {
        const key = JSON.parse(token);
        if (frame.keys.has(key)) {
          const error = new Error('Duplicate decoded JSON key.');
          error.code = 'duplicate_json_key';
          throw error;
        }
        frame.keys.add(key);
        frame.keyNext = false;
      }
    }
  }
  function checkNumbers(item) {
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) {
      const error = new Error('Non-finite and unsafe integer JSON numbers are unsupported.');
      error.code = 'unsupported_json_number';
      throw error;
    }
    if (item && typeof item === 'object') Object.values(item).forEach(checkNumbers);
  }
  checkNumbers(value);
  return value;
}

export function validTimestamp(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || zone === '-00:00') return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}
