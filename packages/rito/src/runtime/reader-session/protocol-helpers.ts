import type { ReaderRevisionId } from './types';
import type {
  JsonObject,
  JsonValue,
  ReaderProtocolError,
  ReaderProtocolErrorCode,
  ReaderRuntimeResponse,
  ReaderRuntimeRevisionScopedResponse,
} from './protocol';

export interface CreateProtocolErrorOptions {
  readonly retryable?: boolean;
  readonly details?: JsonObject;
}

export function createProtocolError(
  code: ReaderProtocolErrorCode,
  message: string,
  options?: CreateProtocolErrorOptions,
): ReaderProtocolError {
  return {
    code,
    message,
    ...(options?.retryable !== undefined ? { retryable: options.retryable } : {}),
    ...(options?.details !== undefined ? { details: options.details } : {}),
  };
}

export function isRevisionScopedResponse(
  response: ReaderRuntimeResponse,
): response is ReaderRuntimeRevisionScopedResponse {
  return response.revisionId !== undefined;
}

export function isCurrentRevisionResponse(
  response: ReaderRuntimeResponse,
  activeRevisionId: ReaderRevisionId,
): boolean {
  return !isRevisionScopedResponse(response) || response.revisionId === activeRevisionId;
}

export function assertProtocolSerializable(payload: unknown): asserts payload is JsonValue {
  assertSerializableValue(payload, '$', new Set<object>());
}

function assertSerializableValue(value: unknown, path: string, seen: Set<object>): void {
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (Number.isFinite(value)) return;
      throw new TypeError(`${path} must be a finite number`);
    case 'object':
      assertSerializableObject(value, path, seen);
      return;
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new TypeError(`${path} contains non-JSON value of type ${typeof value}`);
  }
}

function assertSerializableObject(value: object, path: string, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new TypeError(`${path} contains a circular reference`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSerializableValue(item, `${path}[${String(index)}]`, seen);
    });
    seen.delete(value);
    return;
  }

  if (!isPlainJsonObject(value)) {
    throw new TypeError(`${path} must be a plain JSON object`);
  }

  const objectValue = value as { readonly [key: string]: unknown };
  for (const key of Object.keys(objectValue)) {
    const child = objectValue[key];
    assertSerializableValue(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function isPlainJsonObject(value: object): boolean {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
