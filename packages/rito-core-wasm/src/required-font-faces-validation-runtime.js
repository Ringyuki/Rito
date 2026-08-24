const REQUIRED_FONT_FACE_KEYS = [
  'family',
  'href',
  'style',
  'weight',
  'shapeFingerprint',
  'byteLength',
  'sourceOrder',
];

export function requireRequiredFontFaces(value, revisionId, operation) {
  if (value === undefined) return undefined;
  const manifest = requireExactObject(
    value,
    ['schemaVersion', 'revisionId', 'faces'],
    `${operation} requiredFontFaces`,
  );
  if (manifest.schemaVersion !== 1 || manifest.revisionId !== revisionId) {
    throw new Error(`${operation} returned invalid requiredFontFaces identity`);
  }
  if (!Array.isArray(manifest.faces)) {
    throw new Error(`${operation} returned invalid requiredFontFaces faces`);
  }
  let previousSourceOrder = -1;
  for (const [index, value] of manifest.faces.entries()) {
    const face = requireExactObject(
      value,
      REQUIRED_FONT_FACE_KEYS,
      `${operation} requiredFontFaces.faces[${index}]`,
    );
    requireNonEmptyString(face.family, operation, 'family');
    requireNonEmptyString(face.href, operation, 'href');
    if (!['normal', 'italic', 'oblique'].includes(face.style)) {
      throw new Error(`${operation} returned invalid required font style`);
    }
    if (!Number.isSafeInteger(face.weight) || face.weight < 1 || face.weight > 1000) {
      throw new Error(`${operation} returned invalid required font weight`);
    }
    if (!/^[0-9a-f]{16}$/.test(face.shapeFingerprint)) {
      throw new Error(`${operation} returned invalid required font shapeFingerprint`);
    }
    if (!Number.isSafeInteger(face.byteLength) || face.byteLength <= 0) {
      throw new Error(`${operation} returned invalid required font byteLength`);
    }
    if (!Number.isSafeInteger(face.sourceOrder) || face.sourceOrder <= previousSourceOrder) {
      throw new Error(`${operation} returned invalid required font sourceOrder`);
    }
    previousSourceOrder = face.sourceOrder;
  }
  return manifest;
}

function requireExactObject(value, expectedKeys, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} must be an object`);
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !keys.includes(key))
  ) {
    throw new Error(`${operation} contains invalid fields`);
  }
  return value;
}

function requireNonEmptyString(value, operation, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${operation} returned invalid required font ${field}`);
  }
}
