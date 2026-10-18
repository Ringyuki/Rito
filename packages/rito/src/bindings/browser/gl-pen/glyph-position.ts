const f32 = Math.fround;

/**
 * Where the canvas puts a glyph whose origin is at CSS `x` under
 * `scale(ratio)` after a device `translate(tx)`: the device x in float32
 * arithmetic, as the canvas maps it, on the nearest quarter pixel, a tie
 * going up. Answers whole quarter pixels.
 */
export function deviceQuarters(x: number, ratio: number, tx: number): number {
  return Math.floor(f32(f32(f32(x) * f32(ratio)) + tx) * 4 + 0.5);
}

/** The device row the canvas puts a horizontal baseline at CSS `y` on. */
export function deviceRow(y: number, ratio: number, ty: number): number {
  return Math.floor(f32(f32(f32(y) * f32(ratio)) + ty) + 0.5);
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
