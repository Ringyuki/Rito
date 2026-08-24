import type { CDPSession, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  ReaderMemoryCheckpoint,
  ReaderMemoryDiagnostics,
  ReaderMemorySample,
  ReaderMemoryStabilizationPolicy,
} from './memory-gate-types';
import { memoryFinite, memoryInteger, memoryRecord } from './memory-gate-validation';
import {
  parseMacOSFootprint,
  parseReaderCdpProcesses,
  type ReaderCdpProcess,
} from './memory-process-parser';

const execFileAsync = promisify(execFile);
const FOOTPRINT_PATH = '/usr/bin/footprint';
const BYTES_PER_MIB = 1024 * 1024;

export interface ReaderMemorySampler {
  readonly page: Page;
  readonly browserSession: CDPSession;
  readonly pageSession: CDPSession;
  readonly policy: ReaderMemoryStabilizationPolicy;
}

export async function captureStableReaderMemory(
  sampler: ReaderMemorySampler,
  label: string,
): Promise<ReaderMemoryCheckpoint> {
  const samples: ReaderMemorySample[] = [];
  for (let attempt = 0; attempt < sampler.policy.maxSamples; attempt += 1) {
    await sampler.page.waitForTimeout(sampler.policy.sampleIntervalMs);
    samples.push(await captureMemorySample(sampler));
    const stableWindow = findStableMemoryWindow(samples, sampler.policy);
    if (stableWindow) return buildCheckpoint(label, samples, stableWindow);
  }
  const values = samples.map((sample) => sample.totalPhysFootprintBytes);
  throw new Error(
    `Reader memory checkpoint ${label} did not stabilize within ${String(samples.length)} samples: ${values.map(formatMiB).join(', ')}`,
  );
}

export function findStableMemoryWindow(
  samples: readonly ReaderMemorySample[],
  policy: ReaderMemoryStabilizationPolicy,
): readonly ReaderMemorySample[] | null {
  if (samples.length < policy.minSamples) return null;
  const window = samples.slice(-policy.minSamples);
  const range = sampleRangeBytes(window);
  const growth = sampleGrowthBytes(window);
  return range <= policy.maxSampleRangeMiB * BYTES_PER_MIB &&
    growth <= policy.maxSampleGrowthMiB * BYTES_PER_MIB
    ? window
    : null;
}

async function captureMemorySample(sampler: ReaderMemorySampler): Promise<ReaderMemorySample> {
  const [diagnostics, processes] = await Promise.all([
    captureDiagnostics(sampler.pageSession),
    captureProcessMemoryWithRetry(sampler),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    totalPhysFootprintBytes: processes.reduce(
      (total, process) => total + process.physFootprintBytes,
      0,
    ),
    processes,
    diagnostics,
  };
}

async function captureProcessMemoryWithRetry(sampler: ReaderMemorySampler) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const before = parseReaderCdpProcesses(
        await sampler.browserSession.send('SystemInfo.getProcessInfo'),
      );
      const footprint = await runMacOSFootprint(before);
      const after = parseReaderCdpProcesses(
        await sampler.browserSession.send('SystemInfo.getProcessInfo'),
      );
      requireStableReaderProcessSet(before, after);
      return footprint;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sampler.page.waitForTimeout(100);
    }
  }
  throw new Error('Failed to capture a consistent Chromium process footprint', {
    cause: lastError,
  });
}

export function requireStableReaderProcessSet(
  before: readonly ReaderCdpProcess[],
  after: readonly ReaderCdpProcess[],
): void {
  const beforeIdentity = processIdentity(before);
  const afterIdentity = processIdentity(after);
  if (beforeIdentity !== afterIdentity) {
    throw new Error(
      `Chromium process set changed during footprint capture: before [${beforeIdentity}], after [${afterIdentity}]`,
    );
  }
}

async function runMacOSFootprint(processes: ReturnType<typeof parseReaderCdpProcesses>) {
  if (platform() !== 'darwin') throw new Error('Reader memory gate requires macOS footprint');
  const directory = await mkdtemp(join(tmpdir(), 'rito-reader-footprint-'));
  const outputPath = join(directory, 'footprint.json');
  try {
    const processArguments = processes.flatMap((process) => ['--pid', String(process.pid)]);
    await execFileAsync(
      FOOTPRINT_PATH,
      ['--noCategories', '--format', 'bytes', '--json', outputPath, ...processArguments],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    return parseMacOSFootprint(await readFile(outputPath, 'utf8'), processes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function captureDiagnostics(session: CDPSession): Promise<ReaderMemoryDiagnostics> {
  const [heapValue, domValue] = await Promise.all([
    session.send('Runtime.getHeapUsage'),
    session.send('Memory.getDOMCounters'),
  ]);
  const heap = memoryRecord(heapValue, 'Runtime.getHeapUsage');
  const dom = memoryRecord(domValue, 'Memory.getDOMCounters');
  return {
    pageJsHeapUsedBytes: memoryFinite(heap['usedSize'], 'Runtime.getHeapUsage.usedSize'),
    pageJsHeapTotalBytes: memoryFinite(heap['totalSize'], 'Runtime.getHeapUsage.totalSize'),
    pageEmbedderHeapUsedBytes: optionalFinite(
      heap['embedderHeapUsedSize'],
      'Runtime.getHeapUsage.embedderHeapUsedSize',
    ),
    pageBackingStorageBytes: optionalFinite(
      heap['backingStorageSize'],
      'Runtime.getHeapUsage.backingStorageSize',
    ),
    documents: memoryInteger(dom['documents'], 'Memory.getDOMCounters.documents', 0),
    nodes: memoryInteger(dom['nodes'], 'Memory.getDOMCounters.nodes', 0),
    jsEventListeners: memoryInteger(
      dom['jsEventListeners'],
      'Memory.getDOMCounters.jsEventListeners',
      0,
    ),
  };
}

function optionalFinite(value: unknown, path: string): number | null {
  return value === undefined ? null : memoryFinite(value, path);
}

function buildCheckpoint(
  label: string,
  samples: readonly ReaderMemorySample[],
  stableWindow: readonly ReaderMemorySample[],
): ReaderMemoryCheckpoint {
  const selected = [...stableWindow].sort(
    (left, right) => right.totalPhysFootprintBytes - left.totalPhysFootprintBytes,
  )[0];
  if (!selected) throw new Error(`Reader memory checkpoint ${label} has no stable samples`);
  return {
    label,
    selected,
    stableWindow,
    samples,
    stableRangeBytes: sampleRangeBytes(stableWindow),
    stableGrowthBytes: sampleGrowthBytes(stableWindow),
  };
}

function sampleRangeBytes(samples: readonly ReaderMemorySample[]): number {
  const values = samples.map((sample) => sample.totalPhysFootprintBytes);
  return Math.max(...values) - Math.min(...values);
}

function sampleGrowthBytes(samples: readonly ReaderMemorySample[]): number {
  const first = samples[0]?.totalPhysFootprintBytes;
  const last = samples.at(-1)?.totalPhysFootprintBytes;
  if (first === undefined || last === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, last - first);
}

function processIdentity(processes: readonly ReaderCdpProcess[]): string {
  return [...processes]
    .sort((left, right) => left.pid - right.pid)
    .map((process) => `${String(process.pid)}:${process.type}`)
    .join(', ');
}

function formatMiB(bytes: number): string {
  return `${(bytes / BYTES_PER_MIB).toFixed(2)} MiB`;
}
