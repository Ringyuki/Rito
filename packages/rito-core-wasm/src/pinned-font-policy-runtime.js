import { RitoCoreWasmError } from './core-wasm-error-runtime.js';

const POLICY_KEYS = new Set(['schemaVersion', 'faces']);
const FACE_INPUT_KEYS = new Set(['bytes', 'expectedSha256', 'genericRole', 'language']);
const SUMMARY_KEYS = new Set(['schemaVersion', 'policyId', 'faces']);
const FACE_SUMMARY_KEYS = new Set([
  'sha256',
  'shapeFingerprint',
  'familyAlias',
  'byteLength',
  'genericRole',
  'language',
  'style',
  'weight',
]);
const OPEN_KEYS = new Set(['pinnedFontPolicy']);
const GENERIC_ROLES = new Set(['serif', 'sansSerif', 'monospace']);
const ROLE_ORDER = new Map([
  ['serif', 0],
  ['sansSerif', 1],
  ['monospace', 2],
]);
const EXPECTED_HASH_RE = /^[0-9a-fA-F]{64}$/;
const CANONICAL_HASH_RE = /^[0-9a-f]{64}$/;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

export function openRawDocument(RawDocument, bytes, options) {
  if (!(bytes instanceof Uint8Array)) {
    badRequest('openDocument bytes must be a Uint8Array');
  }
  const pinned = preparePinnedFontPolicyOpen(options);
  if (pinned === undefined) {
    return { inner: new RawDocument(bytes), expectedFaces: [] };
  }
  return {
    inner: RawDocument.openWithPinnedFontPolicy(bytes, pinned.metadataJson, pinned.faceBytes),
    expectedFaces: pinned.expectedFaces,
  };
}
export function decodePinnedFontPolicySummary(payload, expectedFaces) {
  const summary = parsePinnedFontPolicySummary(payload, 'pinnedFontPolicy');
  if (expectedFaces !== undefined) requireExpectedFaces(summary.faces, expectedFaces);
  return summary;
}
function preparePinnedFontPolicyOpen(options) {
  if (options === undefined) return undefined;
  const open = requireInputObject(options, 'openDocument options');
  requireOnlyInputKeys(open, OPEN_KEYS, 'openDocument options');
  if (!Object.hasOwn(open, 'pinnedFontPolicy') || open.pinnedFontPolicy === undefined) {
    return undefined;
  }
  return preparePolicy(open.pinnedFontPolicy);
}
function parsePinnedFontPolicySummary(payload, operation = 'pinnedFontPolicy') {
  const summary = parseSummaryPayload(payload, operation);
  requireExactOutputKeys(summary, SUMMARY_KEYS, `${operation} summary`);
  if (summary.schemaVersion !== 1) {
    throw new Error(`${operation} returned an unsupported schemaVersion`);
  }
  if (typeof summary.policyId !== 'string' || !CANONICAL_HASH_RE.test(summary.policyId)) {
    throw new Error(`${operation} returned an invalid policyId`);
  }
  if (!Array.isArray(summary.faces)) {
    throw new Error(`${operation} returned invalid faces`);
  }
  validateSummaryFaces(summary.faces, operation);
  return summary;
}
function preparePolicy(value) {
  const policy = requireInputObject(value, 'pinned font policy');
  requireExactInputKeys(policy, POLICY_KEYS, 'pinned font policy');
  if (policy.schemaVersion !== 1) {
    badRequest('pinned font policy schemaVersion must be 1');
  }
  if (!Array.isArray(policy.faces) || policy.faces.length === 0) {
    badRequest('pinned font policy faces must be a non-empty array');
  }
  const prepared = policy.faces.map(prepareFace);
  const expectedFaces = prepared.map((face) => face.expected).sort(compareSummaryFaces);
  rejectDuplicateExpectedFaces(expectedFaces);
  return {
    metadataJson: JSON.stringify({
      schemaVersion: 1,
      faces: prepared.map((face) => face.metadata),
    }),
    faceBytes: prepared.map((face) => face.bytes),
    expectedFaces,
  };
}
function prepareFace(value, index) {
  const label = `pinned font face ${String(index)}`;
  const face = requireInputObject(value, label);
  requireOnlyInputKeys(face, FACE_INPUT_KEYS, label);
  for (const field of ['bytes', 'expectedSha256', 'genericRole']) {
    if (!Object.hasOwn(face, field)) badRequest(`${label} is missing ${field}`);
  }
  const bytes = face.bytes;
  const expectedSha256 = face.expectedSha256;
  const genericRole = face.genericRole;
  const language = Object.hasOwn(face, 'language') ? face.language : undefined;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    badRequest(`${label} bytes must be a non-empty Uint8Array`);
  }
  if (typeof expectedSha256 !== 'string' || !EXPECTED_HASH_RE.test(expectedSha256)) {
    badRequest(`${label} expectedSha256 must contain 64 hexadecimal digits`);
  }
  if (!GENERIC_ROLES.has(genericRole)) {
    badRequest(`${label} genericRole is unsupported`);
  }
  const hasLanguage = language !== undefined;
  if (hasLanguage) requireLanguage(language, label, false);
  return {
    bytes,
    expected: {
      sha256: expectedSha256.toLowerCase(),
      byteLength: bytes.byteLength,
      genericRole,
      language: hasLanguage ? language.toLowerCase() : 'und',
    },
    metadata: {
      expectedSha256,
      genericRole,
      ...(hasLanguage ? { language } : {}),
    },
  };
}
function rejectDuplicateExpectedFaces(faces) {
  const hashes = new Set();
  const selectors = new Set();
  for (const face of faces) {
    const selector = `${face.genericRole}\0${face.language}`;
    if (hashes.has(face.sha256)) badRequest('pinned font policy contains duplicate face SHA-256');
    if (selectors.has(selector)) {
      badRequest('pinned font policy contains duplicate genericRole and language');
    }
    hashes.add(face.sha256);
    selectors.add(selector);
  }
}
function requireExpectedFaces(actual, expected) {
  if (actual.length !== expected.length) {
    throw new Error('pinnedFontPolicy returned a face count that does not match its request');
  }
  for (let index = 0; index < actual.length; index += 1) {
    const returned = actual[index];
    const requested = expected[index];
    if (
      returned.sha256 !== requested.sha256 ||
      returned.byteLength !== requested.byteLength ||
      returned.genericRole !== requested.genericRole ||
      returned.language !== requested.language
    ) {
      throw new Error(`pinnedFontPolicy face ${String(index)} does not match its request`);
    }
  }
}
function validateSummaryFaces(faces, operation) {
  const hashes = new Set();
  const aliases = new Set();
  const selectors = new Set();
  let previous;
  for (const [index, value] of faces.entries()) {
    const face = requireSummaryFace(value, index, operation);
    const selector = `${face.genericRole}\0${face.language}`;
    if (hashes.has(face.sha256) || aliases.has(face.familyAlias) || selectors.has(selector)) {
      throw new Error(`${operation} returned duplicate face identity`);
    }
    hashes.add(face.sha256);
    aliases.add(face.familyAlias);
    selectors.add(selector);
    if (previous !== undefined && compareSummaryFaces(previous, face) >= 0) {
      throw new Error(`${operation} returned non-canonical face order`);
    }
    previous = face;
  }
}
function requireSummaryFace(value, index, operation) {
  const label = `${operation} face ${String(index)}`;
  const face = requireOutputObject(value, label);
  requireExactOutputKeys(face, FACE_SUMMARY_KEYS, label);
  requireSummaryFaceIdentity(face, label);
  if (!Number.isSafeInteger(face.byteLength) || face.byteLength <= 0) {
    throw new Error(`${label} returned an invalid byteLength`);
  }
  if (!GENERIC_ROLES.has(face.genericRole)) {
    throw new Error(`${label} returned an unsupported genericRole`);
  }
  requireLanguage(face.language, label, true);
  if (face.style !== 'normal' || face.weight !== 400) {
    throw new Error(`${label} returned unsupported style or weight`);
  }
  return face;
}

function requireSummaryFaceIdentity(face, label) {
  if (typeof face.sha256 !== 'string' || !CANONICAL_HASH_RE.test(face.sha256)) {
    throw new Error(`${label} returned an invalid sha256`);
  }
  if (
    typeof face.shapeFingerprint !== 'string' ||
    !FINGERPRINT_RE.test(face.shapeFingerprint) ||
    face.shapeFingerprint !== face.sha256.slice(0, 16)
  ) {
    throw new Error(`${label} returned an invalid shapeFingerprint`);
  }
  if (face.familyAlias !== `__RitoPinned_${face.sha256}`) {
    throw new Error(`${label} returned an invalid familyAlias`);
  }
}

function compareSummaryFaces(left, right) {
  return (
    ROLE_ORDER.get(left.genericRole) - ROLE_ORDER.get(right.genericRole) ||
    compareStrings(left.language, right.language) ||
    compareStrings(left.sha256, right.sha256)
  );
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireLanguage(value, label, canonical) {
  const valid =
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 63 &&
    isAscii(value) &&
    value.split('-').every((part) => /^[A-Za-z0-9]{1,8}$/.test(part));
  if (!valid || (canonical && value !== value.toLowerCase())) {
    const action = canonical ? 'returned an invalid canonical language' : 'language is invalid';
    if (canonical) throw new Error(`${label} ${action}`);
    badRequest(`${label} ${action}`);
  }
}

function isAscii(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function parseSummaryPayload(payload, operation) {
  if (typeof payload !== 'string') throw new Error(`${operation} returned a non-string payload`);
  try {
    return requireOutputObject(JSON.parse(payload), `${operation} summary`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${operation} returned invalid JSON: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

function requireInputObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    badRequest(`${label} must be an object`);
  }
  return value;
}

function requireOutputObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function requireOnlyInputKeys(value, allowed, label) {
  const unknown = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.has(key),
  );
  if (unknown !== undefined) badRequest(`${label} contains unknown field ${renderKey(unknown)}`);
}

function requireExactInputKeys(value, allowed, label) {
  requireOnlyInputKeys(value, allowed, label);
  const missing = [...allowed].find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) badRequest(`${label} is missing ${missing}`);
}

function requireExactOutputKeys(value, allowed, label) {
  const unknown = Reflect.ownKeys(value).find(
    (key) => typeof key !== 'string' || !allowed.has(key),
  );
  if (unknown !== undefined)
    throw new Error(`${label} contains unknown field ${renderKey(unknown)}`);
  const missing = [...allowed].find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new Error(`${label} is missing ${missing}`);
}

function renderKey(key) {
  return typeof key === 'symbol' ? key.toString() : key;
}

function badRequest(message) {
  throw new RitoCoreWasmError('bad-request', message);
}
