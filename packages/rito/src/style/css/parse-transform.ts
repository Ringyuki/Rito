import type { LengthPct, TransformFn } from '../core/paint-types';

/**
 * Parse a CSS `transform` value into a sequence of structured TransformFn.
 *
 * Supports (the subset EPUB content uses in practice):
 *   - `translate(x[, y])` / `translateX(x)` / `translateY(y)` with `px` and `%`
 *   - `scale(s[, s])` / `scaleX(s)` / `scaleY(s)`
 *   - `rotate(angle)` with `deg`, `rad`, `turn`, or bare number (treated as deg)
 *
 * Unsupported functions (`matrix`, `matrix3d`, `translate3d`, `skew`, etc.)
 * are silently dropped. The caller may log once at resolve time if desired;
 * this parser does not warn — it's called frequently and must stay cheap.
 *
 * Returns an empty array for `none`, empty input, or fully unsupported input.
 */
const FN_RE = /([a-zA-Z][a-zA-Z0-9]*)\(([^)]*)\)/g;
const DEG_TO_RAD = Math.PI / 180;

export function parseTransform(input: string): readonly TransformFn[] {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed === 'none') return [];

  const out: TransformFn[] = [];
  FN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FN_RE.exec(trimmed)) !== null) {
    const name = match[1];
    const argsRaw = (match[2] ?? '').trim();
    if (!name) continue;
    const fn = parseOneFn(name, argsRaw);
    if (fn) out.push(fn);
  }
  return out;
}

function parseOneFn(name: string, args: string): TransformFn | undefined {
  switch (name) {
    case 'rotate':
      return parseRotate(args);
    case 'scale':
      return parseScale(args);
    case 'scaleX': {
      const v = parseFloat(args);
      return isNaN(v) ? undefined : { kind: 'scale', sx: v, sy: 1 };
    }
    case 'scaleY': {
      const v = parseFloat(args);
      return isNaN(v) ? undefined : { kind: 'scale', sx: 1, sy: v };
    }
    case 'translate':
      return parseTranslate(args);
    case 'translateX': {
      const x = parseLengthPct(args);
      if (!x) return undefined;
      return { kind: 'translate', x, y: { unit: 'px', value: 0 } };
    }
    case 'translateY': {
      const y = parseLengthPct(args);
      if (!y) return undefined;
      return { kind: 'translate', x: { unit: 'px', value: 0 }, y };
    }
    default:
      return undefined;
  }
}

function parseRotate(args: string): TransformFn | undefined {
  const rad = parseAngle(args);
  return rad === undefined ? undefined : { kind: 'rotate', rad };
}

function parseAngle(value: string): number | undefined {
  const trimmed = value.trim();
  const n = parseFloat(trimmed);
  if (isNaN(n)) return undefined;
  if (trimmed.endsWith('rad')) return n;
  if (trimmed.endsWith('turn')) return n * 2 * Math.PI;
  // 'deg' or bare number
  return n * DEG_TO_RAD;
}

function parseScale(args: string): TransformFn | undefined {
  const parts = splitArgs(args);
  const sx = parseFloat(parts[0] ?? '');
  if (isNaN(sx)) return undefined;
  const syRaw = parts[1];
  const sy = syRaw === undefined ? sx : parseFloat(syRaw);
  if (isNaN(sy)) return undefined;
  return { kind: 'scale', sx, sy };
}

function parseTranslate(args: string): TransformFn | undefined {
  const parts = splitArgs(args);
  const x = parseLengthPct(parts[0] ?? '0');
  if (!x) return undefined;
  const y = parts[1] === undefined ? ({ unit: 'px', value: 0 } as const) : parseLengthPct(parts[1]);
  if (!y) return undefined;
  return { kind: 'translate', x, y };
}

function parseLengthPct(raw: string): LengthPct | undefined {
  const s = raw.trim();
  if (s.length === 0) return undefined;
  const n = parseFloat(s);
  if (isNaN(n)) return undefined;
  if (s.endsWith('%')) return { unit: 'percent', value: n };
  // 'px' or bare number — bare numbers are CSS-invalid for length but we
  // tolerate them (matching legacy behavior) and treat as px.
  return { unit: 'px', value: n };
}

function splitArgs(args: string): string[] {
  return args
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
