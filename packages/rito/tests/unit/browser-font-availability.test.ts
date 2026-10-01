import { describe, expect, it, vi } from 'vitest';

import type { BrowserReaderWorkerClient } from '../../src/bindings/browser/core-contracts';

interface FakeWorker {
  client: BrowserReaderWorkerClient;
  denylists: readonly (readonly string[])[];
}

function createWorker(): FakeWorker {
  const denylists: (readonly string[])[] = [];
  const client = {
    setUnavailableFontFaces: (families: readonly string[]) => {
      denylists.push([...families]);
      return Promise.resolve();
    },
  } as unknown as BrowserReaderWorkerClient;
  return { client, denylists };
}

/** Each test gets its own module instance: the record is module-level. */
async function loadAvailability() {
  vi.resetModules();
  return import('../../src/bindings/browser/font-availability');
}

describe('browser font availability: the unavailable-face denylist', () => {
  it('keeps reported families, trimmed, and ignores blank ones', async () => {
    const availability = await loadAvailability();

    availability.reportUnavailableFontFamily('  Broken Face  ');
    availability.reportUnavailableFontFamily('   ');
    availability.reportUnavailableFontFamily('Broken Face');

    expect(availability.cachedUnavailableFontFamilies()).toEqual(['Broken Face']);
  });

  it('delivers each family to a worker once and reports that it did', async () => {
    const availability = await loadAvailability();
    const worker = createWorker();
    availability.reportUnavailableFontFamily('Broken Face');

    const first = await availability.syncUnavailableFontFaces(worker.client);
    const second = await availability.syncUnavailableFontFaces(worker.client);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(worker.denylists).toEqual([['Broken Face']]);
  });

  it('replays the denylist into a second worker that has never seen it', async () => {
    const availability = await loadAvailability();
    availability.reportUnavailableFontFamily('Broken Face');
    const first = createWorker();
    const second = createWorker();

    await availability.syncUnavailableFontFaces(first.client);
    await availability.syncUnavailableFontFaces(second.client);

    expect(first.denylists).toEqual([['Broken Face']]);
    expect(second.denylists).toEqual([['Broken Face']]);
  });

  it('reports no work when nothing was rejected', async () => {
    const availability = await loadAvailability();
    const worker = createWorker();

    expect(await availability.syncUnavailableFontFaces(worker.client)).toBe(false);
    expect(worker.denylists).toEqual([]);
  });
});
