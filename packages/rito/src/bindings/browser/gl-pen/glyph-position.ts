const f32 = Math.fround;

/**
 * Where the canvas puts a glyph `offset` CSS px into a string it draws at
 * CSS `origin` under `scale(ratio)` after a device `translate(tx)`. In
 * float32, as the canvas computes it: the string's origin goes into the
 * matrix first (`origin × ratio + tx`), the glyph's offset is mapped and
 * added after; the device x is then rounded to a quarter pixel the way the
 * canvas rounds it — an eighth added in float32, then floored, so a tie
 * goes up and a sum the float rounds up across a quarter goes up too.
 * Answers whole quarter pixels.
 */
export function glyphQuarters(origin: number, offset: number, ratio: number, tx: number): number {
  const scale = f32(ratio);
  const start = f32(f32(f32(origin) * scale) + tx);
  const device = offset === 0 ? start : f32(f32(f32(offset) * scale) + start);
  return Math.floor(f32(device + 0.125) * 4);
}

/** `glyphQuarters` of a glyph drawn on its own at CSS `x`. */
export function deviceQuarters(x: number, ratio: number, tx: number): number {
  return glyphQuarters(x, 0, ratio, tx);
}

/** The device row the canvas puts a horizontal baseline at CSS `y` on: a half added in float32, then floored. */
export function deviceRow(y: number, ratio: number, ty: number): number {
  return Math.floor(f32(f32(f32(f32(y) * f32(ratio)) + ty) + 0.5));
}

/**
 * The CSS coordinate that, drawn under `scale(ratio)` with no translate,
 * lands on `device` (a whole pixel plus a quarter phase) in the canvas's
 * own arithmetic.
 */
export function cssLandingOn(device: number, ratio: number): number {
  const want = Math.round(device * 4);
  let css = device / ratio;
  for (let step = 0; step < 4; step += 1) {
    const got = deviceQuarters(css, ratio, 0);
    if (got === want) return css;
    css += (want - got) / 4 / ratio;
  }
  return css;
}
