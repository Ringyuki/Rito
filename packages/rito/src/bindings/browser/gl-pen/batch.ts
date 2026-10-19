import { INSTANCE_FLOATS, type GlPenDevice } from './device';

export type QuadKind = 'solid' | 'glyph';

interface Scissor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Quads gathered in paint order and drawn with one instanced call per run
 * of the same kind: a quad of another kind, or a change of clip, draws
 * what came before it first. One batch serves every paint of a device,
 * its buffer kept at the largest page it has held.
 */
export class QuadBatch {
  private data = new Float32Array(INSTANCE_FLOATS * 1024);
  private count = 0;
  private kind: QuadKind = 'solid';
  private scissor: Scissor | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly device: GlPenDevice) {}

  /** Starts a paint into a target of `width` × `height` device pixels. */
  begin(width: number, height: number): this {
    this.width = width;
    this.height = height;
    this.count = 0;
    this.kind = 'solid';
    this.scissor = null;
    return this;
  }

  push(
    kind: QuadKind,
    x: number,
    y: number,
    width: number,
    height: number,
    u: number,
    v: number,
    ink: { readonly red: number; readonly green: number; readonly blue: number },
  ): void {
    if (kind !== this.kind) this.flush();
    this.kind = kind;
    if ((this.count + 1) * INSTANCE_FLOATS > this.data.length) this.grow();
    const data = this.data;
    const at = this.count * INSTANCE_FLOATS;
    data[at] = x;
    data[at + 1] = y;
    data[at + 2] = width;
    data[at + 3] = height;
    data[at + 4] = u;
    data[at + 5] = v;
    data[at + 6] = ink.red;
    data[at + 7] = ink.green;
    data[at + 8] = ink.blue;
    data[at + 9] = 1;
    this.count += 1;
  }

  /** `push('glyph', …)`, for the run loop's every inked cluster. */
  glyph(
    x: number,
    y: number,
    width: number,
    height: number,
    u: number,
    v: number,
    ink: { readonly red: number; readonly green: number; readonly blue: number },
  ): void {
    if (this.kind !== 'glyph') {
      this.flush();
      this.kind = 'glyph';
    }
    const at = this.count * INSTANCE_FLOATS;
    if (at + INSTANCE_FLOATS > this.data.length) this.grow();
    const data = this.data;
    data[at] = x;
    data[at + 1] = y;
    data[at + 2] = width;
    data[at + 3] = height;
    data[at + 4] = u;
    data[at + 5] = v;
    data[at + 6] = ink.red;
    data[at + 7] = ink.green;
    data[at + 8] = ink.blue;
    data[at + 9] = 1;
    this.count += 1;
  }

  /** Clips what is drawn from now on to a device rect, or to nothing narrower than the target. */
  clip(scissor: Scissor | null): void {
    if (scissor === this.scissor) return;
    this.flush();
    this.scissor = scissor;
    const gl = this.device.gl;
    if (scissor === null) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const left = Math.max(0, scissor.left);
    const top = Math.max(0, scissor.top);
    const right = Math.max(left, Math.min(this.width, scissor.right));
    const bottom = Math.max(top, Math.min(this.height, scissor.bottom));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(left, this.height - bottom, right - left, bottom - top);
  }

  flush(): void {
    if (this.count === 0) return;
    const { gl, atlas } = this.device;
    const program = this.kind === 'glyph' ? this.device.glyph : this.device.solid;
    if (this.kind === 'glyph') {
      atlas.upload();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
    }
    gl.useProgram(program.program);
    gl.uniform2f(program.size, this.width, this.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.device.instances);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.data.subarray(0, this.count * INSTANCE_FLOATS),
      gl.STREAM_DRAW,
    );
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    this.count = 0;
  }

  private grow(): void {
    const data = new Float32Array(this.data.length * 2);
    data.set(this.data);
    this.data = data;
  }
}
