import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRitoCoreWasmError, RitoCoreWasmError } from '../src/core-wasm-error-runtime.js';

test('structured WASM errors keep their wire code and message', () => {
  for (const code of [
    'bad-request',
    'engine-error',
    'internal-error',
    'unknown-revision',
    'stale-revision-version',
  ]) {
    const cause = new Error(JSON.stringify({ code, message: `${code} happened` }));

    const error = normalizeRitoCoreWasmError(cause);

    assert.ok(error instanceof RitoCoreWasmError);
    assert.equal(error.code, code);
    assert.equal(error.message, `${code} happened`);
    assert.equal(error.cause, cause);
  }
});

test('unstructured failures become internal errors naming the operation', () => {
  const error = normalizeRitoCoreWasmError(new Error('boom'), 'open');

  assert.equal(error.code, 'internal-error');
  assert.equal(error.message, 'open failed: boom');
  assert.equal(normalizeRitoCoreWasmError('plain text', 'read').message, 'read failed: plain text');
  assert.equal(normalizeRitoCoreWasmError(error), error);
});

test('malformed structured payloads are not mistaken for wire errors', () => {
  for (const payload of [
    { code: 'unknown', message: 'x' },
    { code: 'engine-error' },
    { message: 'no code' },
    [],
  ]) {
    const error = normalizeRitoCoreWasmError(new Error(JSON.stringify(payload)));
    assert.equal(error.code, 'internal-error');
  }
});
