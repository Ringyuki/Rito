import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReaderRuntimeCommand, ReaderRuntimeResponse } from '../../src/runtime/reader-session';

export interface RuntimeProtocolFixtureFile {
  readonly successPath: readonly RuntimeProtocolFixtureScenario[];
  readonly structuredErrors: readonly RuntimeProtocolFixtureScenario[];
  readonly malformedOrStaleEnvelopes: readonly RuntimeMalformedProtocolFixtureScenario[];
}

export interface RuntimeProtocolFixtureScenario {
  readonly name: string;
  readonly command: ReaderRuntimeCommand;
  readonly response: ReaderRuntimeResponse;
}

export interface RuntimeMalformedProtocolFixtureScenario extends RuntimeProtocolFixtureScenario {
  readonly expectedErrorCode: string;
}

export function readProtocolFixtures(): RuntimeProtocolFixtureFile {
  const path = join(import.meta.dirname, '../fixtures/reader-runtime/protocol-fixtures.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const record = expectRecord(parsed, path);
  return {
    successPath: readFixtureScenarios(record, 'successPath'),
    structuredErrors: readFixtureScenarios(record, 'structuredErrors'),
    malformedOrStaleEnvelopes: readMalformedFixtureScenarios(record),
  };
}

export function replayJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as unknown as T;
}

function readFixtureScenarios(
  fixture: { readonly [key: string]: unknown },
  key: string,
): readonly RuntimeProtocolFixtureScenario[] {
  const value = fixture[key];
  if (!Array.isArray(value)) throw new Error(`${key} fixture must be an array`);
  return value.map((item, index) => readFixtureScenario(item, `${key}[${String(index)}]`));
}

function readMalformedFixtureScenarios(fixture: {
  readonly [key: string]: unknown;
}): readonly RuntimeMalformedProtocolFixtureScenario[] {
  const value = fixture['malformedOrStaleEnvelopes'];
  if (!Array.isArray(value)) {
    throw new Error('malformedOrStaleEnvelopes fixture must be an array');
  }
  return value.map((item, index) => {
    const label = `malformedOrStaleEnvelopes[${String(index)}]`;
    const scenario = expectRecord(item, label);
    const expectedErrorCode = scenario['expectedErrorCode'];
    if (typeof expectedErrorCode !== 'string' || expectedErrorCode.length === 0) {
      throw new Error(`${label}.expectedErrorCode is invalid`);
    }
    return {
      ...readFixtureScenario(scenario, label),
      expectedErrorCode,
    };
  });
}

function readFixtureScenario(value: unknown, label: string): RuntimeProtocolFixtureScenario {
  const record = expectRecord(value, label);
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${label}.name is invalid`);
  }
  const command = expectRecord(record['command'], `${label}.command`);
  const response = expectRecord(record['response'], `${label}.response`);
  return {
    name,
    command: command as unknown as ReaderRuntimeCommand,
    response: response as unknown as ReaderRuntimeResponse,
  };
}

function expectRecord(value: unknown, label: string): { readonly [key: string]: unknown } {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as { readonly [key: string]: unknown };
  }
  throw new Error(`${label} must be an object`);
}
