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

export interface MockCanvasContextOptions {
  readonly width?: number;
  readonly height?: number;
  readonly charWidthFactor?: number;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const DEFAULT_CHAR_WIDTH_FACTOR = 0.6;

export function createMockCanvasContext(options?: MockCanvasContextOptions): MockCanvasContext {
  const records: CanvasRecord[] = [];
  const target: Record<string, unknown> = {};
  const canvas = {
    width: options?.width ?? DEFAULT_WIDTH,
    height: options?.height ?? DEFAULT_HEIGHT,
  };
  const charWidthFactor = options?.charWidthFactor ?? DEFAULT_CHAR_WIDTH_FACTOR;
  let transformScale = 1;
  const transformStack: number[] = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(state, prop: string | symbol) {
      if (prop === 'toJSON') return undefined;
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return createMeasureText(state, records, charWidthFactor);
      if (prop === 'getTransform') return createGetTransform(records, () => transformScale);
      if (prop === 'save') return createSave(records, transformStack, () => transformScale);
      if (prop === 'restore')
        return createRestore(records, transformStack, (scale) => (transformScale = scale));
      if (prop === 'scale') return createScale(records, (scale) => (transformScale *= scale));
      if (typeof prop === 'symbol') return undefined;
      if (prop in state) return state[prop];

      // Methods
      return (...args: unknown[]) => {
        records.push({ method: prop, args });
      };
    },
    set(state, prop: string | symbol, value: unknown) {
      if (typeof prop === 'symbol') return false;
      state[prop] = value;
      records.push({ property: prop, value });
      return true;
    },
  };

  const ctx = new Proxy(target, handler) as unknown as CanvasRenderingContext2D;

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

function createMeasureText(
  state: Readonly<Record<string, unknown>>,
  records: CanvasRecord[],
  charWidthFactor: number,
): (text: string) => TextMetrics {
  return (text: string) => {
    records.push({ method: 'measureText', args: [text] });
    return {
      width: text.length * readFontSize(state['font']) * charWidthFactor,
    } as TextMetrics;
  };
}

function createGetTransform(
  records: CanvasRecord[],
  readTransformScale: () => number,
): () => DOMMatrix {
  return () => {
    records.push({ method: 'getTransform', args: [] });
    return { a: readTransformScale() } as DOMMatrix;
  };
}

function createSave(
  records: CanvasRecord[],
  transformStack: number[],
  readTransformScale: () => number,
): () => void {
  return () => {
    transformStack.push(readTransformScale());
    records.push({ method: 'save', args: [] });
  };
}

function createRestore(
  records: CanvasRecord[],
  transformStack: number[],
  writeTransformScale: (scale: number) => void,
): () => void {
  return () => {
    writeTransformScale(transformStack.pop() ?? 1);
    records.push({ method: 'restore', args: [] });
  };
}

function createScale(
  records: CanvasRecord[],
  multiplyTransformScale: (scale: number) => void,
): (x: number, y: number) => void {
  return (x: number, y: number) => {
    multiplyTransformScale(x);
    records.push({ method: 'scale', args: [x, y] });
  };
}

function readFontSize(font: unknown): number {
  if (typeof font !== 'string') return 16;
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = match?.[1];
  return size === undefined ? 16 : Number(size);
}
