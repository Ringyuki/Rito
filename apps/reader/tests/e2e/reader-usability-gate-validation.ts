export function parseJson(source: string, path: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Invalid reader usability manifest JSON at ${path}`, { cause: error });
  }
}

export function exactRecord<const K extends string>(
  value: unknown,
  keys: readonly K[],
  path: string,
): Record<K, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(path, 'must be an object');
  }
  const record = value as Record<string, unknown>;
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  const unknown = Object.keys(record).filter((key) => !keys.includes(key as K));
  if (missing.length > 0 || unknown.length > 0) {
    throw invalid(
      path,
      [
        missing.length && `missing ${missing.join(', ')}`,
        unknown.length && `unknown ${unknown.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; '),
    );
  }
  return record as Record<K, unknown>;
}

export function nonEmptyArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid(path, 'must be a non-empty array');
  }
  return value;
}

export function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(path, 'must be a non-empty string');
  }
  return value;
}

export function boundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Infinity,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    const upper = maximum === Infinity ? 'infinity' : String(maximum);
    throw invalid(path, `must be an integer from ${String(minimum)} to ${upper}`);
  }
  return value as number;
}

export function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(path, 'must be a positive finite number');
  }
  return value;
}

export function invalid(path: string, message: string): Error {
  return new Error(`Invalid reader usability gate ${path}: ${message}`);
}
