import { RitoCoreWasmError } from './core-wasm-error-runtime.js';
import {
  preparePinnedFontPolicyOpen,
  validatePinnedFontPolicySummary,
} from './pinned-font-policy-runtime.js';

const OPEN_RESULT_KEYS = new Set(['publication', 'pinnedFontPolicy']);
const OPEN_REQUEST_KEYS = new Set([
  'id',
  'kind',
  'data',
  'pinnedFontPolicyMetadata',
  'pinnedFontFaceBuffers',
]);
const POLICY_METADATA_KEYS = new Set(['schemaVersion', 'faces']);
const FACE_METADATA_KEYS = new Set(['expectedSha256', 'genericRole', 'language']);
const REQUIRED_FACE_METADATA_KEYS = ['expectedSha256', 'genericRole'];

export function prepareReaderWorkerOpen(data, options) {
  requirePublicationBuffer(data);
  const pinned = preparePinnedFontPolicyOpen(options, 'arrayBuffer');
  const faceBuffers = pinned?.faceBytes ?? [];
  requireDistinctBuffers(data, faceBuffers);
  return {
    request: {
      kind: 'open',
      data,
      ...(pinned === undefined
        ? {}
        : {
            pinnedFontPolicyMetadata: pinned.metadata,
            pinnedFontFaceBuffers: faceBuffers,
          }),
    },
    transfer: [data, ...faceBuffers],
    expectedFaces: pinned?.expectedFaces ?? [],
  };
}

export function decodeReaderWorkerOpenRequest(request) {
  requireOnlyInputKeys(request, OPEN_REQUEST_KEYS, 'reader worker open request');
  requirePublicationBuffer(request.data);
  const hasMetadata = Object.hasOwn(request, 'pinnedFontPolicyMetadata');
  const hasBuffers = Object.hasOwn(request, 'pinnedFontFaceBuffers');
  if (hasMetadata !== hasBuffers) {
    badRequest('reader worker pinned font metadata and buffers must be supplied together');
  }
  if (!hasMetadata) {
    return { data: request.data, options: undefined, expectedFaces: [] };
  }
  const metadata = requireMetadata(request.pinnedFontPolicyMetadata);
  const faceBuffers = request.pinnedFontFaceBuffers;
  if (!Array.isArray(faceBuffers) || faceBuffers.length !== metadata.faces.length) {
    badRequest('reader worker pinned font buffer count does not match its metadata');
  }
  validateMetadataFaces(metadata.faces);
  requireDistinctBuffers(request.data, faceBuffers);
  const pinned = preparePinnedFontPolicyOpen(
    {
      pinnedFontPolicy: {
        schemaVersion: metadata.schemaVersion,
        faces: metadata.faces.map((face, index) => ({ ...face, bytes: faceBuffers[index] })),
      },
    },
    'arrayBuffer',
  );
  return {
    data: request.data,
    options: {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: pinned.metadata.faces.map((face, index) => ({
          ...face,
          bytes: new Uint8Array(pinned.faceBytes[index]),
        })),
      },
    },
    expectedFaces: pinned.expectedFaces,
  };
}

export function validateReaderWorkerOpenResult(value, expectedFaces) {
  const result = requireObject(value, 'reader worker open result');
  requireExactKeys(result, OPEN_RESULT_KEYS, 'reader worker open result');
  requireObject(result.publication, 'reader worker publication');
  return {
    publication: result.publication,
    pinnedFontPolicy: validatePinnedFontPolicySummary(
      requireObject(result.pinnedFontPolicy, 'reader worker pinned font policy'),
      expectedFaces,
      'reader worker open',
    ),
  };
}

function requireMetadata(value) {
  const metadata = requireObject(value, 'reader worker pinned font metadata', true);
  requireExactInputKeys(metadata, POLICY_METADATA_KEYS, 'reader worker pinned font metadata');
  if (!Array.isArray(metadata.faces)) {
    badRequest('reader worker pinned font metadata faces must be an array');
  }
  return metadata;
}

function validateMetadataFaces(faces) {
  for (const [index, value] of faces.entries()) {
    const label = `reader worker pinned font metadata face ${String(index)}`;
    const face = requireObject(value, label, true);
    requireOnlyInputKeys(face, FACE_METADATA_KEYS, label);
    for (const key of REQUIRED_FACE_METADATA_KEYS) {
      if (!Object.hasOwn(face, key)) badRequest(`${label} is missing ${key}`);
    }
  }
}

function requireDistinctBuffers(data, faceBuffers) {
  const seen = new Set([data]);
  for (const [index, buffer] of faceBuffers.entries()) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
      badRequest(
        `reader worker pinned font buffer ${String(index)} must be a non-empty ArrayBuffer`,
      );
    }
    if (seen.has(buffer)) {
      badRequest('reader worker publication and pinned font buffers must be exclusive');
    }
    seen.add(buffer);
  }
}

function requirePublicationBuffer(value) {
  if (!(value instanceof ArrayBuffer)) {
    badRequest('reader worker publication must be an ArrayBuffer');
  }
}

function requireObject(value, label, input = false) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (input) badRequest(`${label} must be an object`);
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, allowed, label) {
  const keys = Reflect.ownKeys(value);
  const unknown = keys.find((key) => typeof key !== 'string' || !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${label} contains an unknown field`);
  const missing = [...allowed].find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new Error(`${label} is missing ${missing}`);
}

function requireOnlyInputKeys(value, allowed, label) {
  const unknown = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.has(key),
  );
  if (unknown !== undefined) badRequest(`${label} contains an unknown field`);
}

function requireExactInputKeys(value, allowed, label) {
  requireOnlyInputKeys(value, allowed, label);
  const missing = [...allowed].find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) badRequest(`${label} is missing ${missing}`);
}

function badRequest(message) {
  throw new RitoCoreWasmError('bad-request', message);
}
