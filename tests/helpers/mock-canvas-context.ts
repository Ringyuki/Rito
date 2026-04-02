/**
 * A recording mock of CanvasRenderingContext2D for testing.
 * Records all property sets and method calls in order.
 */

export interface CanvasCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface CanvasPropertySet {
  readonly property: string;
  readonly value: unknown;
}

export type CanvasRecord = CanvasCall | CanvasPropertySet;

export function isCall(r: CanvasRecord): r is CanvasCall {
  return 'method' in r;
}

export function isPropertySet(r: CanvasRecord): r is CanvasPropertySet {
  return 'property' in r;
}

export interface MockCanvasContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly records: readonly CanvasRecord[];
  getCalls(method: string): CanvasCall[];
  getPropertySets(property: string): CanvasPropertySet[];
}

export function createMockCanvasContext(): MockCanvasContext {
  const records: CanvasRecord[] = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'toJSON') return undefined;

      // Methods
      return (...args: unknown[]) => {
        records.push({ method: prop, args });
      };
    },
    set(_target, prop: string, value: unknown) {
      records.push({ property: prop, value });
      return true;
    },
  };

  const ctx = new Proxy(
    {} as Record<string, unknown>,
    handler,
  ) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    records,
    getCalls(method: string): CanvasCall[] {
      return records.filter((r): r is CanvasCall => isCall(r) && r.method === method);
    },
    getPropertySets(property: string): CanvasPropertySet[] {
      return records.filter(
        (r): r is CanvasPropertySet => isPropertySet(r) && r.property === property,
      );
    },
  };
}
