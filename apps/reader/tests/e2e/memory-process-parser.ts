import type { ReaderMemoryProcessSample } from './memory-gate-types';
import {
  exactMemoryRecord,
  invalidMemory,
  memoryArray,
  memoryFinite,
  memoryInteger,
  memoryRecord,
  memoryText,
  parseMemoryJson,
} from './memory-gate-validation';

export interface ReaderCdpProcess {
  readonly pid: number;
  readonly type: string;
  readonly cpuTimeSeconds: number;
}

export function parseReaderCdpProcesses(value: unknown): ReaderCdpProcess[] {
  const root = exactMemoryRecord(value, ['processInfo'], 'SystemInfo.getProcessInfo');
  const processes = memoryArray(root.processInfo, 'SystemInfo.getProcessInfo.processInfo').map(
    (entry, index) => {
      const path = `SystemInfo.getProcessInfo.processInfo[${String(index)}]`;
      const record = exactMemoryRecord(entry, ['type', 'id', 'cpuTime'], path);
      return {
        pid: memoryInteger(record.id, `${path}.id`, 1),
        type: memoryText(record.type, `${path}.type`),
        cpuTimeSeconds: memoryFinite(record.cpuTime, `${path}.cpuTime`),
      };
    },
  );
  requireUniquePids(
    processes.map((process) => process.pid),
    'SystemInfo.getProcessInfo',
  );
  if (processes.length === 0) {
    throw invalidMemory('SystemInfo.getProcessInfo.processInfo', 'must not be empty');
  }
  return processes.sort((left, right) => left.pid - right.pid);
}

export function parseMacOSFootprint(
  source: string,
  expectedProcesses: readonly ReaderCdpProcess[],
): ReaderMemoryProcessSample[] {
  const root = memoryRecord(parseMemoryJson(source, 'footprint'), 'footprint');
  if (root['unit'] !== 'byte' || root['bytes per unit'] !== 1) {
    throw invalidMemory('footprint.unit', 'must report bytes with one byte per unit');
  }
  requireEmptyDiagnostics(root['errors'], 'footprint.errors');
  requireEmptyDiagnostics(root['warnings'], 'footprint.warnings');
  const expected = new Map(expectedProcesses.map((process) => [process.pid, process]));
  const samples = memoryArray(root['processes'], 'footprint.processes').map((entry, index) => {
    const path = `footprint.processes[${String(index)}]`;
    const record = memoryRecord(entry, path);
    const pid = memoryInteger(record['pid'], `${path}.pid`, 1);
    const cdpProcess = expected.get(pid);
    if (!cdpProcess) throw invalidMemory(`${path}.pid`, `unexpected process ${String(pid)}`);
    const auxiliary = memoryRecord(record['auxiliary'], `${path}.auxiliary`);
    return {
      pid,
      type: cdpProcess.type,
      name: memoryText(record['name'], `${path}.name`),
      cpuTimeSeconds: cdpProcess.cpuTimeSeconds,
      physFootprintBytes: memoryInteger(
        auxiliary['phys_footprint'],
        `${path}.auxiliary.phys_footprint`,
        0,
      ),
    };
  });
  requireUniquePids(
    samples.map((sample) => sample.pid),
    'footprint.processes',
  );
  const actualPids = new Set(samples.map((sample) => sample.pid));
  const missing = [...expected.keys()].filter((pid) => !actualPids.has(pid));
  if (missing.length > 0) {
    throw invalidMemory('footprint.processes', `missing processes ${missing.join(', ')}`);
  }
  return samples.sort((left, right) => left.pid - right.pid);
}

function requireEmptyDiagnostics(value: unknown, path: string): void {
  const entries = memoryArray(value, path);
  if (entries.length > 0)
    throw invalidMemory(path, `must be empty, received ${String(entries.length)}`);
}

function requireUniquePids(pids: readonly number[], path: string): void {
  if (new Set(pids).size !== pids.length) {
    throw invalidMemory(path, 'contains duplicate process ids');
  }
}
