export function requiredField(object, key, path) {
  const fieldPath = `${path}.${key}`;
  if (!Object.hasOwn(object, key)) {
    invalidFrameCommand(fieldPath, 'field to be present');
  }
  return object[key];
}

export function validateOptionalField(object, key, path, validate) {
  if (!Object.hasOwn(object, key)) return;
  validate(object[key], `${path}.${key}`);
}

export function expectObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidFrameCommand(path, 'object');
  }
  return value;
}

export function expectArray(value, path) {
  if (!Array.isArray(value)) invalidFrameCommand(path, 'array');
  return value;
}

export function expectString(value, path) {
  if (typeof value !== 'string') invalidFrameCommand(path, 'string');
  return value;
}

export function expectBoolean(value, path) {
  if (typeof value !== 'boolean') invalidFrameCommand(path, 'boolean');
  return value;
}

export function expectFiniteNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidFrameCommand(path, 'finite number');
  }
  return value;
}

export function expectNonNegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalidFrameCommand(path, 'non-negative safe integer');
  }
  return value;
}

export function expectEnum(value, path, values) {
  expectString(value, path);
  if (!values.includes(value)) {
    invalidFrameCommand(path, `one of ${values.join(', ')}`);
  }
  return value;
}

export function validateArrayItems(value, path, validateItem) {
  const array = expectArray(value, path);
  for (const [index, item] of array.entries()) {
    validateItem(item, `${path}[${String(index)}]`);
  }
}

export function validateRect(value, path) {
  const rect = expectObject(value, path);
  validateFiniteFields(rect, path, ['x', 'y', 'width', 'height']);
}

export function validatePoint(value, path) {
  const point = expectObject(value, path);
  validateFiniteFields(point, path, ['x', 'y']);
}

export function validateSize(value, path) {
  const size = expectObject(value, path);
  validateFiniteFields(size, path, ['width', 'height']);
}

export function validateResolvedRadius(value, path) {
  const radius = expectObject(value, path);
  validateFiniteFields(radius, path, ['rx', 'ry']);
}

export function validateSpacing(value, path) {
  const spacing = expectObject(value, path);
  validateFiniteFields(spacing, path, ['top', 'right', 'bottom', 'left']);
}

export function validateFiniteFields(object, path, keys) {
  for (const key of keys) {
    expectFiniteNumber(requiredField(object, key, path), `${path}.${key}`);
  }
}

export function invalidFrameCommand(path, expected) {
  throw new Error(`Invalid Rito frame command buffer command at ${path}: expected ${expected}.`);
}
