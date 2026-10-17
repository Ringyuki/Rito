import type { Page } from '@playwright/test';

/**
 * One entry of the page's reader log: a request a reader sent its session,
 * by method name, or something it noted.
 */
export interface ReaderSessionLogEntry {
  /** Which reader on the page, counted from 1 in the order they opened. */
  readonly reader: number;
  readonly kind: string;
  readonly detail: string | null;
  /** Answered, failed, or neither: unanswered, or a note. */
  readonly ok: boolean | null;
}

interface ReaderLogGlobal {
  __ritoReaderDiagnostics?: {
    log(): readonly {
      readonly reader: number;
      readonly kind: string;
      readonly detail?: string;
      readonly ms?: number;
      readonly failed?: true;
    }[];
  };
}

/**
 * What every reader on the page asked its session and how it was answered,
 * oldest first, as the reader's own log has it. A page no reader opened on
 * has an empty log.
 */
export async function readReaderSessionLog(page: Page): Promise<readonly ReaderSessionLogEntry[]> {
  return page.evaluate(() => {
    const diagnostics = (globalThis as typeof globalThis & ReaderLogGlobal).__ritoReaderDiagnostics;
    if (!diagnostics) return [];
    return diagnostics.log().map((entry) => ({
      reader: entry.reader,
      kind: entry.kind,
      detail: entry.detail ?? null,
      ok: entry.failed === true ? false : entry.ms === undefined ? null : true,
    }));
  });
}

/** Each session a reader opened: the faces it was opened with, and whether it opened. */
export function pinnedFaceOpens(log: readonly ReaderSessionLogEntry[]): readonly {
  readonly reader: number;
  readonly sha256: readonly string[];
  readonly ok: boolean | null;
}[] {
  const faces = new Map<number, readonly string[]>();
  const opens: { reader: number; sha256: readonly string[]; ok: boolean | null }[] = [];
  for (const entry of log) {
    if (entry.kind === 'pinnedFaces') {
      faces.set(entry.reader, JSON.parse(entry.detail ?? '[]') as readonly string[]);
    } else if (entry.kind === 'openSession') {
      opens.push({ reader: entry.reader, sha256: faces.get(entry.reader) ?? [], ok: entry.ok });
    }
  }
  return opens;
}
