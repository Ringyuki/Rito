import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRitoCoreWasmError, RitoCoreWasmError } from '../src/core-wasm-error-runtime.js';

const VALID_REVISION = {
  revisionId: 'rev-7',
  revisionVersion: 3,
  layoutKey: 'layout-key',
  status: 'failed',
  knownExtent: { pageCount: 4, spreadCount: 2 },
  pageCount: 4,
  spreadCount: 2,
};

test('structured WASM errors retain a valid failed revision summary', () => {
  const cause = new Error(
    JSON.stringify({
      code: 'engine-error',
      message: 'revision failed',
      revision: VALID_REVISION,
    }),
  );

  const error = normalizeRitoCoreWasmError(cause);

  assert.equal(error.code, 'engine-error');
  assert.equal(error.message, 'revision failed');
  assert.deepEqual(error.revision, VALID_REVISION);
});

test('structured WASM errors recognize revision access error codes without recovery metadata', () => {
  for (const code of ['unknown-revision', 'stale-revision-version']) {
    const error = normalizeRitoCoreWasmError(
      new Error(JSON.stringify({ code, message: 'revision access failed' })),
    );

    assert.equal(error.code, code);
    assert.equal(error.message, 'revision access failed');
    assert.equal(error.revision, undefined);
  }
});

test('structured WASM errors discard malformed revision recovery metadata', () => {
  const malformed = [
    { ...VALID_REVISION, revisionId: ' ' },
    { ...VALID_REVISION, revisionVersion: -1 },
    { ...VALID_REVISION, revisionVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...VALID_REVISION, layoutKey: '' },
    { ...VALID_REVISION, status: 'unknown' },
    { ...VALID_REVISION, knownExtent: { pageCount: 1, spreadCount: 2 } },
    { ...VALID_REVISION, finalExtent: VALID_REVISION.knownExtent },
    { ...VALID_REVISION, status: 'complete' },
    {
      ...VALID_REVISION,
      status: 'complete',
      finalExtent: { pageCount: 5, spreadCount: 3 },
    },
    { ...VALID_REVISION, pageCount: 5 },
    { ...VALID_REVISION, spreadCount: 3 },
  ];

  for (const revision of malformed) {
    const cause = new Error(
      JSON.stringify({ code: 'engine-error', message: 'not found', revision }),
    );
    const error = normalizeRitoCoreWasmError(cause);

    assert.equal(error.code, 'engine-error');
    assert.equal(error.message, 'not found');
    assert.equal(error.revision, undefined);
  }
});

test('revision recovery metadata requires both engine-error and failed status', () => {
  const wrongCode = normalizeRitoCoreWasmError(
    new Error(
      JSON.stringify({ code: 'unknown-revision', message: 'not found', revision: VALID_REVISION }),
    ),
  );
  const wrongStatus = normalizeRitoCoreWasmError(
    new Error(
      JSON.stringify({
        code: 'engine-error',
        message: 'not failed',
        revision: { ...VALID_REVISION, status: 'ready' },
      }),
    ),
  );
  const constructed = new RitoCoreWasmError('internal-error', 'forged', {
    revision: VALID_REVISION,
  });

  assert.equal(wrongCode.revision, undefined);
  assert.equal(wrongStatus.revision, undefined);
  assert.equal(constructed.revision, undefined);
});
