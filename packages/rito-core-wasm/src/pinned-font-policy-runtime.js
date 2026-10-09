// A reader session's host faces as a host hands them over: the policy a
// session opens with, and faces added while it is open. What is checked
// here never reaches the engine malformed; the engine checks the bytes.

const POLICY_KEYS = new Set(['schemaVersion', 'faces']);
const FACE_INPUT_KEYS = new Set(['bytes', 'expectedSha256', 'genericRole', 'language']);
const OPEN_KEYS = new Set(['pinnedFontPolicy']);
const GENERIC_ROLES = new Set(['serif', 'sansSerif', 'monospace']);
const ROLE_ORDER = { serif: 0, sansSerif: 1, monospace: 2 };
const EXPECTED_HASH_RE = /^[0-9a-fA-F]{64}$/;

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

function requireInputObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    badRequest(`${label} must be an object`);
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

function renderKey(key) {
  return typeof key === 'symbol' ? key.toString() : key;
}

function badRequest(message) {
  throw Object.assign(new Error(message), { name: 'RitoReaderError', code: 'invalid-request' });
}
