const VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
uniform vec4 uRect;
uniform vec2 uSize;
out vec2 vUv;
out float vAlong;
void main() {
  vec2 point = uRect.xy + corner * uRect.zw;
  // A texture's last row is the top of what it shows.
  vUv = vec2(corner.x, 1.0 - corner.y);
  vAlong = corner.x;
  gl_Position = vec4(point.x / uSize.x * 2.0 - 1.0, 1.0 - point.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const TEXTURE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uOpacity;
in vec2 vUv;
in float vAlong;
out vec4 fragment;
void main() {
  fragment = texture(uImage, vUv) * uOpacity;
}`;

const RAMP_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uAlpha;
in vec2 vUv;
in float vAlong;
out vec4 fragment;
void main() {
  fragment = vec4(0.0, 0.0, 0.0, mix(uAlpha.x, uAlpha.y, vAlong));
}`;

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

/** A rect in the target's device pixels, y down. */
export interface QuadRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Draws textures and shadows as quads into whichever framebuffer is
 * bound, premultiplied over what is there.
 */
export interface GlCompositor {
  readonly gl: WebGL2RenderingContext;
  /** Binds a framebuffer (null: the canvas's own) at its size, for what is drawn next. */
  bind(framebuffer: WebGLFramebuffer | null, width: number, height: number): void;
  /** Clears what is bound to nothing. */
  clear(): void;
  /** A texture stretched over `rect`, at `opacity`. */
  drawTexture(texture: WebGLTexture, rect: QuadRect, opacity?: number): void;
  /** A black ramp over `rect`, its alpha going from `from` at the left edge to `to` at the right. */
  drawRamp(rect: QuadRect, from: number, to: number): void;
  /** Makes its programs again, in a context restored after it was lost. */
  restore(): void;
}

export function createCompositor(gl: WebGL2RenderingContext): GlCompositor {
  const made = () => ({
    vertexArray: cornerQuad(gl),
    textured: link(gl, TEXTURE_FRAGMENT, ['uRect', 'uSize', 'uImage', 'uOpacity']),
    ramp: link(gl, RAMP_FRAGMENT, ['uRect', 'uSize', 'uAlpha']),
  });
  let { vertexArray, textured, ramp } = made();
  let size = { width: 1, height: 1 };
  const quad = (program: Program, rect: QuadRect): void => {
    useQuad(gl, program, rect, size);
  };
  const draw = (): void => {
    drawQuad(gl, vertexArray);
  };
  return {
    gl,
    bind(framebuffer, width, height): void {
      size = { width, height };
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
    },
    clear(): void {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    drawTexture(texture, rect, opacity = 1): void {
      if (opacity <= 0) return;
      quad(textured, rect);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textured.uniforms['uImage'] ?? null, 0);
      gl.uniform1f(textured.uniforms['uOpacity'] ?? null, Math.min(1, opacity));
      draw();
    },
    drawRamp(rect, from, to): void {
      quad(ramp, rect);
      gl.uniform2f(ramp.uniforms['uAlpha'] ?? null, from, to);
      draw();
    },
    restore(): void {
      ({ vertexArray, textured, ramp } = made());
    },
  };
}

/** Uses `program` to draw over `rect` of a target `size` device pixels large. */
function useQuad(
  gl: WebGL2RenderingContext,
  program: Program,
  rect: QuadRect,
  size: { readonly width: number; readonly height: number },
): void {
  gl.useProgram(program.program);
  gl.uniform4f(program.uniforms['uRect'] ?? null, rect.x, rect.y, rect.width, rect.height);
  gl.uniform2f(program.uniforms['uSize'] ?? null, size.width, size.height);
}

/** Draws the quad, premultiplied over what is there. */
function drawQuad(gl: WebGL2RenderingContext, vertexArray: WebGLVertexArrayObject): void {
  gl.bindVertexArray(vertexArray);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

/** A vertex array of one quad's four corners, 0 to 1 either way, drawn as a strip. */
function cornerQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vertexArray;
}

function link(gl: WebGL2RenderingContext, fragment: string, uniforms: readonly string[]): Program {
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('the reader display could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(
      `the reader display's program did not link: ${gl.getProgramInfoLog(program) ?? ''}`,
    );
  }
  return {
    program,
    uniforms: Object.fromEntries(
      uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
    ),
  };
}
