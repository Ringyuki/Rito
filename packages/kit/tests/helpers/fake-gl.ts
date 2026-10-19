/**
 * A WebGL2 context for tests where there is none: every call is recorded,
 * objects it creates are plain records, and each draw remembers what was
 * bound when it was made.
 */
export interface FakeGlDraw {
  readonly kind: 'drawArrays' | 'drawArraysInstanced' | 'drawElements' | 'blitFramebuffer';
  readonly program: unknown;
  readonly texture: unknown;
  readonly framebuffer: unknown;
  /** The uniforms set on the program in use, by name. */
  readonly uniforms: Readonly<Record<string, readonly unknown[]>>;
}

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  readonly calls: { readonly name: string; readonly args: readonly unknown[] }[];
  readonly draws: FakeGlDraw[];
  /** The calls made of one method. */
  named(name: string): (readonly unknown[])[];
  /** Makes the context lost, as the browser would. */
  lose(): void;
}

interface Created {
  readonly created: string;
  readonly id: number;
}

const PARAMETERS: Readonly<Record<string, number>> = {
  MAX_TEXTURE_SIZE: 4096,
  MAX_SAMPLES: 4,
};

/** `programsLink` false makes every program fail to link, as a GPU that cannot run them would. */
export function createFakeGl(
  canvas: object = { addEventListener: () => undefined, width: 1, height: 1 },
  { programsLink = true }: { readonly programsLink?: boolean } = {},
): FakeGl {
  const calls: { name: string; args: readonly unknown[] }[] = [];
  const draws: FakeGlDraw[] = [];
  const constants = new Map<string, number>();
  const uniforms = new Map<unknown, Record<string, readonly unknown[]>>();
  const bound: Record<string, unknown> = {
    program: null,
    texture: null,
    framebuffer: null,
    read: null,
    draw: null,
  };
  let created = 0;
  let lost = false;
  const constant = (name: string): number => {
    let value = constants.get(name);
    if (value === undefined) {
      value = 0x1000 + constants.size;
      constants.set(name, value);
    }
    return value;
  };
  const nameOf = (value: unknown): string | undefined =>
    [...constants].find(([, number]) => number === value)?.[0];
  const record = (kind: FakeGlDraw['kind']): void => {
    draws.push({
      kind,
      program: bound['program'],
      texture: bound['texture'],
      framebuffer: kind === 'blitFramebuffer' ? bound['draw'] : bound['framebuffer'],
      uniforms: { ...(uniforms.get(bound['program']) ?? {}) },
    });
  };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    isContextLost: () => lost,
    getExtension: () => null,
    getProgramParameter: () => programsLink,
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
    getUniformLocation: (_program, name) => ({ uniform: name }),
    getParameter: (parameter) => {
      const name = nameOf(parameter) ?? '';
      if (name === 'FRAMEBUFFER_BINDING' || name === 'DRAW_FRAMEBUFFER_BINDING')
        return bound['draw'];
      if (name === 'READ_FRAMEBUFFER_BINDING') return bound['read'];
      return PARAMETERS[name] ?? 0;
    },
    useProgram: (program) => {
      bound['program'] = program;
    },
    bindTexture: (_target, texture) => {
      bound['texture'] = texture;
    },
    bindFramebuffer: (target, framebuffer) => {
      const name = nameOf(target);
      if (name !== 'READ_FRAMEBUFFER') bound['draw'] = framebuffer;
      if (name !== 'DRAW_FRAMEBUFFER') bound['read'] = framebuffer;
      bound['framebuffer'] = bound['draw'];
    },
    drawArrays: () => {
      record('drawArrays');
    },
    drawArraysInstanced: () => {
      record('drawArraysInstanced');
    },
    drawElements: () => {
      record('drawElements');
    },
    blitFramebuffer: () => {
      record('blitFramebuffer');
    },
  };
  const gl = new Proxy(
    {},
    {
      get(_target, property): unknown {
        if (typeof property !== 'string') return undefined;
        if (property === 'canvas') return canvas;
        if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
        return (...args: unknown[]): unknown => {
          calls.push({ name: property, args });
          if (property.startsWith('uniform')) {
            const location = args[0] as { uniform?: string } | null;
            if (location?.uniform !== undefined) {
              const set = uniforms.get(bound['program']) ?? {};
              set[location.uniform] = args.slice(1);
              uniforms.set(bound['program'], set);
            }
            return undefined;
          }
          if (property.startsWith('create')) {
            created += 1;
            return { created: property.slice('create'.length), id: created } satisfies Created;
          }
          return methods[property]?.(...args);
        };
      },
    },
  ) as WebGL2RenderingContext;
  return {
    gl,
    calls,
    draws,
    named: (name) => calls.filter((call) => call.name === name).map((call) => call.args),
    lose(): void {
      lost = true;
    },
  };
}
