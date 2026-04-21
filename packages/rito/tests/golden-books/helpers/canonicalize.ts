import { createHash } from 'node:crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonObject = { readonly [key: string]: JsonValue };

const FLOAT_DIGITS = 3;

export function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** FLOAT_DIGITS;
  return Math.round(value * factor) / factor;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === 'object') return objectToJsonValue(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? null;
  return null;
}

function objectToJsonValue(value: object): JsonObject {
  const entries: [string, JsonValue][] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw !== undefined) entries.push([key, toJsonValue(raw)]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries) as JsonObject;
}

export function stableStringify(value: JsonValue): string {
  return `${stringifyJson(value, 0)}\n`;
}

export function hashJson(value: JsonValue): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}

function stringifyJson(value: JsonValue, depth: number): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isJsonArray(value)) return stringifyArray(value, depth);
  return stringifyObject(value, depth);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function stringifyArray(values: readonly JsonValue[], depth: number): string {
  if (values.length === 0) return '[]';
  const indent = spaces(depth + 1);
  const closing = spaces(depth);
  return `[\n${values.map((value) => `${indent}${stringifyJson(value, depth + 1)}`).join(',\n')}\n${closing}]`;
}

function stringifyObject(value: { readonly [key: string]: JsonValue }, depth: number): string {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return '{}';
  const indent = spaces(depth + 1);
  const closing = spaces(depth);
  const lines = entries.map(
    ([key, entry]) => `${indent}${JSON.stringify(key)}: ${stringifyJson(entry, depth + 1)}`,
  );
  return `{\n${lines.join(',\n')}\n${closing}}`;
}

function spaces(depth: number): string {
  return '  '.repeat(depth);
}
