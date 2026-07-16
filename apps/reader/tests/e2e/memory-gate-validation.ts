export function parseMemoryJson(source: string, subject: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Invalid reader memory ${subject} JSON`, { cause: error });
  }
}

export function memoryRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidMemory(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

export function exactMemoryRecord<const K extends string>(
  value: unknown,
  keys: readonly K[],
  path: string,
): Record<K, unknown> {
  const record = memoryRecord(value, path);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  const unknown = Object.keys(record).filter((key) => !keys.includes(key as K));
  if (missing.length > 0 || unknown.length > 0) {
    throw invalidMemory(
      path,
      [
        missing.length > 0 ? `missing ${missing.join(', ')}` : '',
        unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
      ]
        .filter((part) => part.length > 0)
        .join('; '),
    );
  }
  return record as Record<K, unknown>;
}

export function memoryArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidMemory(path, 'must be an array');
  return value;
}

export function nonEmptyMemoryArray(value: unknown, path: string): readonly unknown[] {
  const entries = memoryArray(value, path);
  if (entries.length === 0) throw invalidMemory(path, 'must be a non-empty array');
  return entries;
}

export function memoryText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidMemory(path, 'must be a non-empty string');
  }
  return value;
}

export function memoryInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidMemory(path, `must be an integer from ${String(minimum)} to ${String(maximum)}`);
  }
  return value as number;
}

export function memoryFinite(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw invalidMemory(
      path,
      `must be a finite number greater than or equal to ${String(minimum)}`,
    );
  }
  return value;
}

export function memorySha256(value: unknown, path: string): string {
  const hash = memoryText(value, path);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw invalidMemory(path, 'must be 64 lowercase hexadecimal characters');
  }
  return hash;
}

export function invalidMemory(path: string, message: string): Error {
  return new Error(`Invalid reader memory gate ${path}: ${message}`);
}
