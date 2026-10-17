import type { BrowserHostLogger } from './host-runtime';

/**
 * One thing a reader did. The log exists so that a report of something going
 * wrong can carry what the reader was asked and what it answered, in order
 * and with timings, instead of a description from memory.
 */
export interface ReaderLogEntry {
  /** When it began, on the page's clock (`performance.now()`). */
  readonly at: number;
  /** Which reader on the page, counted from 1 in the order they opened. */
  readonly reader: number;
  /**
   * A session request by its method name, or `pinnedFaces`, `commit`,
   * `warn`, `error`, `dispose`.
   */
  readonly kind: string;
  /** What it was asked with, shortened. */
  readonly detail?: string;
  /** How long a request took. */
  readonly ms?: number;
  /** A request that has been sent and not answered. */
  readonly pending?: true;
  /** What it answered, or why it failed, shortened. */
  readonly result?: string;
  readonly failed?: true;
  /** How many identical requests in a row this entry stands for. */
  readonly times?: number;
}

/** A request that has begun; one of the two closes its entry. */
export interface ReaderLogSpan {
  readonly end: (result?: unknown) => void;
  readonly fail: (error: unknown) => void;
}

export interface ReaderEventLog {
  note(kind: string, detail?: unknown): void;
  begin(kind: string, detail?: unknown): ReaderLogSpan;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// A page keeps one log for every reader it opens, so a report made after a
// second book was opened still holds what happened in the first.
const ENTRY_LIMIT = 4000;
const entries: Mutable<ReaderLogEntry>[] = [];
let readers = 0;

/** The page's reader log, oldest first. */
export function readerEventLogEntries(): readonly ReaderLogEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

/** A log for one reader: its entries carry that reader's number. */
export function openReaderEventLog(): ReaderEventLog {
  readers += 1;
  const reader = readers;
  const push = (kind: string, detail: unknown): Mutable<ReaderLogEntry> => {
    const entry: Mutable<ReaderLogEntry> = { at: now(), reader, kind };
    const described = detail === undefined ? '' : describeForLog(detail);
    if (described !== '') entry.detail = described;
    entries.push(entry);
    if (entries.length > ENTRY_LIMIT) entries.splice(0, entries.length - ENTRY_LIMIT);
    return entry;
  };
  return {
    note(kind, detail) {
      push(kind, detail);
    },
    begin(kind, detail) {
      const entry = repeatOfLast(reader, kind, detail) ?? push(kind, detail);
      // Unanswered until closed: a request that hangs shows as one.
      const carried = entry.ms ?? 0;
      delete entry.ms;
      entry.pending = true;
      const startedAt = now();
      const close = (result: unknown): void => {
        delete entry.pending;
        entry.ms = round(carried + (now() - startedAt));
        const described = result === undefined ? '' : describeForLog(result);
        if (described !== '') entry.result = described;
      };
      return {
        end: close,
        fail(error) {
          close(error);
          entry.failed = true;
        },
      };
    },
  };
}

/**
 * A request repeated with the same arguments straight after one that was
 * answered (the steps of a background layout) is counted on that entry
 * instead of filling the log with copies of it.
 */
function repeatOfLast(
  reader: number,
  kind: string,
  detail: unknown,
): Mutable<ReaderLogEntry> | undefined {
  const last = entries[entries.length - 1];
  if (last?.reader !== reader || last.kind !== kind) return undefined;
  if (last.ms === undefined || last.failed === true) return undefined;
  const described = detail === undefined ? undefined : describeForLog(detail);
  if ((last.detail ?? '') !== (described ?? '')) return undefined;
  last.times = (last.times ?? 1) + 1;
  return last;
}

/**
 * The same session, with every request it is sent written to `log` when it
 * begins and closed when it is answered. The promises a caller gets are the
 * session's own, so nothing a reader awaits moves by a tick.
 */
export function recordReaderSession<T extends object>(session: T, log: ReaderEventLog): T {
  const recorded = new Map<PropertyKey, unknown>();
  return new Proxy(session, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      let wrapped = recorded.get(key);
      if (wrapped === undefined) {
        const method = value as (...args: unknown[]) => unknown;
        wrapped = (...args: unknown[]): unknown => {
          const span = log.begin(key, args.length === 1 ? args[0] : args.length ? args : undefined);
          let answer: unknown;
          try {
            answer = method.apply(target, args);
          } catch (error) {
            span.fail(error);
            throw error;
          }
          if (!isThenable(answer)) {
            span.end(answer);
            return answer;
          }
          answer.then(span.end, span.fail);
          return answer;
        };
        recorded.set(key, wrapped);
      }
      return wrapped;
    },
  });
}

/** The same logger, with its warnings and errors also written to `log`. */
export function recordReaderLogger(
  logger: BrowserHostLogger,
  log: ReaderEventLog,
): BrowserHostLogger {
  const recording =
    (kind: 'warn' | 'error') =>
    (message: string, ...args: readonly unknown[]): void => {
      log.note(kind, [message, ...args.map(describeForLog)].join(' '));
      logger[kind](message, ...args);
    };
  return { ...logger, warn: recording('warn'), error: recording('error') };
}

const TEXT_LIMIT = 96;
const ENTRY_TEXT_LIMIT = 360;
const KEY_LIMIT = 24;
const LIST_LIMIT = 6;

/**
 * A value in the few words a log line has room for: scalars as they are,
 * bytes and long lists by their size, strings by their first 96
 * characters, objects by their fields two levels down. An artifact is its
 * numbers and sizes; an answer that is text (a footnote, a selected range,
 * an annotation's quote) shows up to that much of it.
 */
export function describeForLog(value: unknown): string {
  const text = describe(value, 0);
  return text.length > ENTRY_TEXT_LIMIT ? `${text.slice(0, ENTRY_TEXT_LIMIT)}…` : text;
}

function describe(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return JSON.stringify(value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT)}…` : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return typeof value === 'number' ? String(round(value)) : String(value);
  }
  if (typeof value !== 'object') return typeof value;
  if (value instanceof Error) return describeError(value);
  if (value instanceof ArrayBuffer) return `<${String(value.byteLength)} bytes>`;
  if (ArrayBuffer.isView(value)) return `<${String(value.byteLength)} bytes>`;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `<${String(value.size)} bytes>`;
  if (Array.isArray(value)) return describeList(value as readonly unknown[], depth);
  if (value instanceof Map || value instanceof Set) return `<${String(value.size)} entries>`;
  if (depth >= 2) return '{…}';
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined && typeof field !== 'function')
    .slice(0, KEY_LIMIT)
    .map(([key, field]) => `${key}: ${describe(field, depth + 1)}`);
  return `{${fields.join(', ')}}`;
}

function describeList(list: readonly unknown[], depth: number): string {
  const scalars = list.every((item) => item === null || typeof item !== 'object');
  if (!scalars || list.length > LIST_LIMIT) return `[${String(list.length)}]`;
  return `[${list.map((item) => describe(item, depth + 1)).join(', ')}]`;
}

function describeError(error: Error): string {
  const code = (error as { readonly code?: unknown }).code;
  const named = typeof code === 'string' ? `${error.name}(${code})` : error.name;
  return `${named}: ${error.message}`;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

function now(): number {
  return round(typeof performance === 'undefined' ? Date.now() : performance.now());
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
