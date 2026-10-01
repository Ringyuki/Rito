import type { BrowserReaderWorkerClient } from './core-contracts';

/**
 * Publication faces the host's font decoder rejected. The engine must stop
 * shaping with a face the canvas cannot paint (a shaper-only face measures
 * runs the paint then draws with a fallback font), so each rejected
 * family is delivered to every worker and the layout reflows once.
 *
 * The record is module-level: a face rejected once stays rejected for
 * every document and worker opened later in the session.
 */
const unavailableFaces = new Set<string>();
const deliveredUnavailableFaces = new WeakMap<object, Set<string>>();

/** Families already known rejected, replayed into workers opened later. */
export function cachedUnavailableFontFamilies(): readonly string[] {
  return [...unavailableFaces];
}

export function reportUnavailableFontFamily(family: string): void {
  const key = family.trim();
  if (key.length === 0) return;
  unavailableFaces.add(key);
}

/**
 * Delivers the families the worker has not received yet. Returns whether
 * any reached it — the caller must reflow then, so the committed layout
 * no longer shapes with them.
 */
export async function syncUnavailableFontFaces(
  worker: BrowserReaderWorkerClient,
): Promise<boolean> {
  const delivered = deliveredUnavailableFaces.get(worker) ?? new Set<string>();
  const fresh = [...unavailableFaces].filter((family) => !delivered.has(family));
  if (fresh.length === 0) return false;
  await worker.setUnavailableFontFaces(fresh);
  for (const family of fresh) delivered.add(family);
  deliveredUnavailableFaces.set(worker, delivered);
  return true;
}
