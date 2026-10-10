// What the page did, kept so that a report of something going wrong can
// carry it: what the reader was told to do, the controller's events, console
// warnings and errors, uncaught failures and long tasks. `buildDebugReport()`
// merges it with the reader's own log of session requests into one text a
// tester copies and sends.

interface PageLogEntry {
  readonly at: number;
  readonly kind: string;
  readonly detail: string;
}

/** An entry of the reader's own log, as `__ritoReaderDiagnostics.log()` returns it. */
interface ReaderLogEntry {
  readonly at: number;
  readonly reader: number;
  readonly kind: string;
  readonly detail?: string;
  readonly ms?: number;
  readonly pending?: true;
  readonly result?: string;
  readonly failed?: true;
  readonly times?: number;
}

interface ReaderDiagnostics {
  readonly log?: () => readonly ReaderLogEntry[];
  readonly layout?: () => unknown;
  readonly queue?: () => unknown;
  readonly rejectedFontFamilies?: () => readonly string[];
}

const ENTRY_LIMIT = 2000;
const REPORT_ENTRY_LIMIT = 1500;
const DETAIL_LIMIT = 300;
const entries: PageLogEntry[] = [];

/** Notes something the page did or was told. */
export function noteDebug(kind: string, detail?: unknown): void {
  entries.push({ at: clock(), kind, detail: describe(detail) });
  if (entries.length > ENTRY_LIMIT) entries.splice(0, entries.length - ENTRY_LIMIT);
}

/** Everything known about this page and its readers, as text to send with a report. */
export function buildDebugReport(): string {
  const diagnostics = (globalThis as { __ritoReaderDiagnostics?: ReaderDiagnostics })
    .__ritoReaderDiagnostics;
  const lines = [...entries.map(pageLine), ...(diagnostics?.log?.() ?? []).map(readerLine)]
    .sort((a, b) => a.at - b.at)
    .map((line) => line.text);
  const shown = lines.slice(-REPORT_ENTRY_LIMIT);
  return [
    '# Rito debug log',
    `time: ${new Date().toISOString()} (page clock ${String(clock())} ms)`,
    `url: ${location.href}`,
    `build: ${import.meta.env.MODE}`,
    `agent: ${navigator.userAgent}`,
    `window: ${String(innerWidth)}x${String(innerHeight)} at ${String(devicePixelRatio)}x`,
    `canvas: ${canvasSize()}`,
    `layout: ${describe(safely(() => diagnostics?.layout?.()))}`,
    `queue: ${describe(safely(() => diagnostics?.queue?.()))}`,
    `showing: ${describe(safely(showing))}`,
    `fonts refused: ${describe(safely(() => diagnostics?.rejectedFontFamilies?.()))}`,
    '',
    `## events — ${String(shown.length)} of ${String(lines.length)}; ms on the page clock; ` +
      '#n is reader n, page is this app',
    ...shown,
    '',
  ].join('\n');
}

/**
 * Puts the report on the clipboard, or saves it as a file where the page
 * may not write to the clipboard. Resolves to which of the two happened.
 */
export async function copyDebugReport(): Promise<'copied' | 'saved'> {
  const report = buildDebugReport();
  try {
    await navigator.clipboard.writeText(report);
    return 'copied';
  } catch {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `rito-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    return 'saved';
  }
}

function pageLine(entry: PageLogEntry): { at: number; text: string } {
  return { at: entry.at, text: line(entry.at, 'page', entry.kind, entry.detail) };
}

function readerLine(entry: ReaderLogEntry): { at: number; text: string } {
  const repeated = entry.times === undefined ? '' : ` ×${String(entry.times)}`;
  let outcome = '';
  if (entry.pending === true) outcome = ' → NO ANSWER YET';
  else if (entry.ms !== undefined) {
    outcome = ` → ${entry.failed === true ? 'FAILED ' : ''}${String(entry.ms)} ms`;
    if (entry.result !== undefined) outcome += ` ${entry.result}`;
  }
  const detail = `${entry.detail ?? ''}${repeated}${outcome}`;
  return { at: entry.at, text: line(entry.at, `#${String(entry.reader)}`, entry.kind, detail) };
}

function line(at: number, source: string, kind: string, detail: string): string {
  return `${at.toFixed(1).padStart(10)}  ${source.padEnd(5)} ${kind.padEnd(22)} ${detail}`.trimEnd();
}

function describe(value: unknown): string {
  if (value === undefined) return '';
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else {
    try {
      text = JSON.stringify(value, (_key, field: unknown) =>
        typeof field === 'bigint' ? String(field) : field,
      );
    } catch {
      text = Object.prototype.toString.call(value);
    }
  }
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

/** Where the controller says the reader is. */
function showing(): unknown {
  const controller = (
    globalThis as {
      __ritoController?: {
        readonly currentSpread?: number;
        readonly reader?: { readonly totalSpreads?: number; readonly pageCount?: number };
      } | null;
    }
  ).__ritoController;
  if (!controller) return 'no book open';
  return {
    spread: controller.currentSpread,
    spreads: controller.reader?.totalSpreads,
    pages: controller.reader?.pageCount,
  };
}

function canvasSize(): string {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 'none';
  const box = canvas.getBoundingClientRect();
  return `${String(canvas.width)}x${String(canvas.height)} drawn at ${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
}

function safely<T>(read: () => T): T | string {
  try {
    return read();
  } catch (error) {
    return `unreadable: ${describe(error)}`;
  }
}

function clock(): number {
  return Math.round(performance.now() * 10) / 10;
}

/** Notes what is written to the console at `level`, and still writes it. */
function watchConsole(level: 'warn' | 'error'): void {
  /* eslint-disable no-console -- the console is what is being watched */
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    noteDebug(`console.${level}`, args.map(describe).join(' '));
    original(...args);
  };
  /* eslint-enable no-console */
}

let watching = false;

/** Starts noting what the page itself reports: failures, console output, long tasks. */
export function watchPage(): void {
  if (watching) return;
  watching = true;
  addEventListener('error', (event) => {
    noteDebug('uncaught', event.error ?? event.message);
  });
  addEventListener('unhandledrejection', (event) => {
    noteDebug('unhandled-rejection', event.reason);
  });
  document.addEventListener('visibilitychange', () => {
    noteDebug('visibility', document.visibilityState);
  });
  // What the tester did. A key that types a character is not noted: what is
  // typed into a field stays out of the log.
  addEventListener(
    'keydown',
    (event) => {
      const chord = event.ctrlKey || event.metaKey || event.altKey;
      if (event.key.length === 1 && event.key !== ' ' && !chord) return;
      const held = [
        event.ctrlKey && 'ctrl',
        event.metaKey && 'meta',
        event.altKey && 'alt',
        event.shiftKey && 'shift',
      ].filter(Boolean);
      noteDebug('key', [...held, event.key === ' ' ? 'Space' : event.key].join('+'));
    },
    true,
  );
  for (const type of ['pointerdown', 'pointerup', 'pointercancel'] as const) {
    addEventListener(
      type,
      (event) => {
        const on = event.target instanceof HTMLCanvasElement ? 'page' : 'ui';
        noteDebug(
          type,
          `${event.pointerType} on ${on} at ${String(Math.round(event.clientX))},${String(Math.round(event.clientY))}`,
        );
      },
      true,
    );
  }
  watchConsole('warn');
  watchConsole('error');
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    // A task that held the page for 50 ms or more: where a stutter was.
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) {
        entries.push({
          at: Math.round(task.startTime * 10) / 10,
          kind: 'long-task',
          detail: `${String(Math.round(task.duration))} ms`,
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // The browser does not report long tasks.
  }
}
