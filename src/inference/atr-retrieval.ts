import { ATRPassageRecord } from "./atr-ma-corpus.js";

export interface ATRRetrievalHit {
  record: ATRPassageRecord;
  score: number;
  matched_terms: string[];
}

const stop = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","how","i","in","is","it","of","on","or","should","that","the","their","this","to","was","what","when","with","would","you"
]);

function terms(text: string): string[] {
  return [...new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !stop.has(term)),
  )];
}

function recordTerms(record: ATRPassageRecord): Map<string, number> {
  const weighted = new Map<string, number>();
  const add = (value: string, weight: number) => {
    for (const term of terms(value)) weighted.set(term, Math.max(weighted.get(term) ?? 0, weight));
  };

  record.concepts.forEach((concept) => add(concept.replaceAll("_", " "), 5));
  add(record.paraphrase, 3);
  add(record.notes, 2);
  add(record.anchor_text, 1);
  for (const edge of record.reasoning_edges) {
    add(edge.from.replaceAll("_", " "), 4);
    add(edge.relation.replaceAll("_", " "), 2);
    add(edge.to.replaceAll("_", " "), 4);
  }
  return weighted;
}

export function retrieveATRPassages(
  query: string,
  corpus: readonly ATRPassageRecord[],
  limit = 4,
): ATRRetrievalHit[] {
  if (!query.trim()) throw new Error("ATR retrieval query must not be empty.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("ATR retrieval limit must be between 1 and 20.");

  const queryTerms = terms(query);
  const scored = corpus.map((record) => {
    const indexed = recordTerms(record);
    const matched = queryTerms.filter((term) => indexed.has(term));
    const score = matched.reduce((total, term) => total + (indexed.get(term) ?? 0), 0);
    return { record, score, matched_terms: matched };
  });

  const positive = scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.record.record_id.localeCompare(b.record.record_id));

  if (positive.length > 0) return positive.slice(0, limit);

  return [...corpus]
    .sort((a, b) => a.record_id.localeCompare(b.record_id))
    .slice(0, Math.min(limit, corpus.length))
    .map((record) => ({ record, score: 0, matched_terms: [] }));
}

export function evidenceRef(record: ATRPassageRecord): string {
  return `MA-CORPUS-0001:${record.locator}`;
}
