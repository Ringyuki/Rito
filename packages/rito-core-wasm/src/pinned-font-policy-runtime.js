import { RitoCoreWasmError } from './core-wasm-error-runtime.js';

const POLICY_KEYS = new Set(['schemaVersion', 'faces']);
const FACE_INPUT_KEYS = new Set(['bytes', 'expectedSha256', 'genericRole', 'language']);
const SUMMARY_KEYS = new Set(['schemaVersion', 'policyId', 'faces']);
const FACE_SUMMARY_KEYS = new Set(
  'sha256 familyName shapeFingerprint familyAlias byteLength genericRole language style weight'.split(
    ' ',
  ),
);
const FACE_STYLES = new Set(['normal', 'italic']);
const OPEN_KEYS = new Set(['pinnedFontPolicy']);
const GENERIC_ROLES = new Set(['serif', 'sansSerif', 'monospace']);
const ROLE_ORDER = { serif: 0, sansSerif: 1, monospace: 2 };
const EXPECTED_HASH_RE = /^[0-9a-fA-F]{64}$/;
const CANONICAL_HASH_RE = /^[0-9a-f]{64}$/;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

export function openRawDocument(RawDocument, bytes, options) {
  if (!(bytes instanceof Uint8Array)) {
    badRequest('openDocument bytes must be a Uint8Array');
  }
  const pinned = preparePinnedFontPolicyOpen(options);
  const inner =
    pinned === undefined
      ? new RawDocument(bytes)
      : RawDocument.openWithPinnedFontPolicy(
          bytes,
          JSON.stringify(pinned.metadata),
          pinned.faceBytes,
        );
  return { inner, expectedFaces: pinned === undefined ? [] : pinned.expectedFaces };
}
/**
 * Opens a publication from its skeleton shard. A sharded open always pins
 * faces: chapters lay out only through the pinned-face fragment engine.
 */
export function openRawShardDocument(RawDocument, skeleton, key, options) {
  if (!(skeleton instanceof Uint8Array)) {
    badRequest('openShardDocument skeleton must be a Uint8Array');
  }
  requireShardKey(key);
  const pinned = preparePinnedFontPolicyOpen(options);
  if (pinned === undefined) {
    badRequest('openShardDocument requires a pinned font policy');
  }
  const inner = RawDocument.openShardsWithPinnedFontPolicy(
    skeleton,
    key,
    JSON.stringify(pinned.metadata),
    pinned.faceBytes,
  );
  return { inner, expectedFaces: pinned.expectedFaces };
}

/** A shard key is absent for plain shards or exactly 32 bytes. */
export function requireShardKey(key) {
  if (key !== undefined && !(key instanceof Uint8Array && key.byteLength === 32)) {
    badRequest('a shard key must be a 32-byte Uint8Array');
  }
}

export function decodePinnedFontPolicySummary(payload, expectedFaces) {
  const summary = parseSummaryPayload(payload, 'pinnedFontPolicy');
  return validatePinnedFontPolicySummary(summary, expectedFaces, 'pinnedFontPolicy');
}
export function validatePinnedFontPolicySummary(summary, expectedFaces, operation) {
  const label = operation ?? 'pinnedFontPolicy';
  requireExactOutputKeys(summary, SUMMARY_KEYS, `${label} summary`);
  if (summary.schemaVersion !== 1) {
    throw new Error(`${label} returned an unsupported schemaVersion`);
  }
  if (typeof summary.policyId !== 'string' || !CANONICAL_HASH_RE.test(summary.policyId)) {
    throw new Error(`${label} returned an invalid policyId`);
  }
  if (!Array.isArray(summary.faces)) {
    throw new Error(`${label} returned invalid faces`);
  }
  validateSummaryFaces(summary.faces, label);
  if (expectedFaces !== undefined) requireExpectedFaces(summary.faces, expectedFaces);
  return summary;
}
export function preparePinnedFontPolicyOpen(options, bytesKind = 'uint8array') {
  if (options === undefined) return undefined;
  const open = requireInputObject(options, 'openDocument options');
  requireOnlyInputKeys(open, OPEN_KEYS, 'openDocument options');
  if (!Object.hasOwn(open, 'pinnedFontPolicy') || open.pinnedFontPolicy === undefined) {
    return undefined;
  }
  return preparePolicy(open.pinnedFontPolicy, bytesKind);
}
function preparePolicy(value, bytesKind) {
  const policy = requireInputObject(value, 'pinned font policy');
  requireExactInputKeys(policy, POLICY_KEYS, 'pinned font policy');
  if (policy.schemaVersion !== 1) {
    badRequest('pinned font policy schemaVersion must be 1');
  }
  if (!Array.isArray(policy.faces) || policy.faces.length === 0) {
    badRequest('pinned font policy faces must be a non-empty array');
  }
  const prepared = policy.faces.map((face, index) => prepareFace(face, index, bytesKind));
  const expectedFaces = prepared.map((face) => face.expected).sort(compareSummaryFaces);
  rejectDuplicateExpectedFaces(expectedFaces);
  return {
    metadata: {
      schemaVersion: 1,
      faces: prepared.map((face) => face.metadata),
    },
    faceBytes: prepared.map((face) => face.bytes),
    expectedFaces,
  };
}
function prepareFace(value, index, bytesKind) {
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
  const validBytes =
    bytesKind === 'arrayBuffer'
      ? bytes instanceof ArrayBuffer
      : bytesKind === 'uint8array' && bytes instanceof Uint8Array;
  if (!validBytes || bytes.byteLength === 0) {
    const name = bytesKind === 'arrayBuffer' ? 'ArrayBuffer' : 'Uint8Array';
    badRequest(`${label} bytes must be a non-empty ${name}`);
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
/**
 * Validates host faces added to an open document: the same face contract
 * as an open's policy, except that a face may share its role and language
 * with another. The faces keep the order given.
 */
export function prepareHostFontFaces(value, bytesKind = 'uint8array') {
  if (!Array.isArray(value) || value.length === 0) {
    badRequest('host font faces must be a non-empty array');
  }
  const prepared = value.map((face, index) => prepareFace(face, index, bytesKind));
  const hashes = new Set();
  for (const face of prepared) {
    if (hashes.has(face.expected.sha256)) badRequest('host font faces repeat a SHA-256');
    hashes.add(face.expected.sha256);
  }
  return {
    metadata: { schemaVersion: 1, faces: prepared.map((face) => face.metadata) },
    faceBytes: prepared.map((face) => face.bytes),
    expectedFaces: prepared.map((face) => face.expected),
  };
}

/** Decodes the summary an addition returns: the added faces at its end. */
export function decodeExtendedFontPolicySummary(payload, addedFaces) {
  const summary = validatePinnedFontPolicySummary(
    parseSummaryPayload(payload, 'addHostFontFaces'),
    undefined,
    'addHostFontFaces',
  );
  requireExpectedFaces(summary.faces.slice(-addedFaces.length), addedFaces);
  return summary;
}

/** The face identities a summary pins, in its order: what a later read checks. */
export function expectedFacesOfSummary(summary) {
  return summary.faces.map((face) => ({
    sha256: face.sha256,
    byteLength: face.byteLength,
    genericRole: face.genericRole,
    language: face.language,
  }));
}

/** Decodes the summary a removal returns. */
export function decodeFontPolicySummary(payload, operation) {
  return validatePinnedFontPolicySummary(
    parseSummaryPayload(payload, operation),
    undefined,
    operation,
  );
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
// The faces a document opened with come back in canonical order (checked
// against the request); faces added later follow in the order added, and
// may share a role and language with another face.
function validateSummaryFaces(faces, operation) {
  const hashes = new Set();
  const aliases = new Set();
  for (const [index, value] of faces.entries()) {
    const face = requireSummaryFace(value, index, operation);
    if (hashes.has(face.sha256) || aliases.has(face.familyAlias)) {
      throw new Error(`${operation} returned duplicate face identity`);
    }
    hashes.add(face.sha256);
    aliases.add(face.familyAlias);
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
  if (typeof face.familyName !== 'string' || face.familyName.length === 0) {
    throw new Error(`${label} returned an invalid familyName`);
  }
  if (
    !FACE_STYLES.has(face.style) ||
    !Number.isSafeInteger(face.weight) ||
    face.weight < 1 ||
    face.weight > 1000
  ) {
    throw new Error(`${label} returned an invalid style or weight`);
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
    ROLE_ORDER[left.genericRole] - ROLE_ORDER[right.genericRole] ||
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
