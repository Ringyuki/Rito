/**
 * The paper turn's shaders as Flutter compiles them, made from the web's:
 * the same text, its declarations restated for Impeller. The web's shaders
 * are the source; nothing of a body is rewritten. What changes:
 *
 * - `#version`, `precision` and `#extension` lines go; the first generation
 *   of WebGL's words (`attribute`, `varying`, `gl_FragColor`, `texture2D`)
 *   are restated as Impeller's;
 * - every uniform but a sampler goes into one block a stage, with no name of
 *   its own, so a body names it as before; a value both stages declare is
 *   in both blocks;
 * - a varying gets the same location in both stages, from its name;
 * - a vertex shader's clip depth is moved from GL's -w..w to Impeller's
 *   0..w after the web's `main`, which gives GL's window depth;
 * - a program reading a texture another pass rendered reads its rows
 *   through `uFlip`, as the backend stores them (`readTarget`); pages are
 *   uploaded top row first and read as they are.
 */
import {
  CAST_FRAGMENT,
  CAST_VERTEX,
  COVER_FRAGMENT,
  COVER_VERTEX,
  OCCLUSION_FRAGMENT,
  QUAD_VERTEX,
  BLUR_FRAGMENT,
  SHADOW_FRAGMENT,
} from '../../src/driver/paper/shadow-shaders';
import { sheetFragment, sheetVertex } from '../../src/driver/paper/shaders';
import * as light from '../../src/driver/paper/light';

type Stage = 'vertex' | 'fragment';

interface Entry {
  readonly name: string;
  readonly stage: Stage;
  readonly source: string;
  /** Whether it reads textures another pass rendered. */
  readonly readsTargets?: boolean;
}

/** Every varying the shaders pass, at one location each. */
const VARYINGS = ['vAt', 'vHeight', 'vLit', 'vPast', 'vUv'];

export const FLUTTER_SHADERS: readonly Entry[] = [
  { name: 'SheetVertex', stage: 'vertex', source: sheetVertex(false) },
  { name: 'SheetFragment', stage: 'fragment', source: sheetFragment(false, false) },
  { name: 'SheetSoftenedFragment', stage: 'fragment', source: sheetFragment(true, false) },
  { name: 'CastVertex', stage: 'vertex', source: CAST_VERTEX },
  { name: 'CastFragment', stage: 'fragment', source: CAST_FRAGMENT },
  { name: 'CoverVertex', stage: 'vertex', source: COVER_VERTEX },
  { name: 'CoverFragment', stage: 'fragment', source: COVER_FRAGMENT },
  { name: 'QuadVertex', stage: 'vertex', source: QUAD_VERTEX },
  { name: 'OcclusionFragment', stage: 'fragment', source: OCCLUSION_FRAGMENT, readsTargets: true },
  { name: 'BlurFragment', stage: 'fragment', source: BLUR_FRAGMENT, readsTargets: true },
  { name: 'LayFragment', stage: 'fragment', source: SHADOW_FRAGMENT, readsTargets: true },
];

const UNIFORM = /^\s*uniform\s+(\w+)\s+(\w+)(\[\d+\])?\s*;\s*$/;
const ATTRIBUTE = /^\s*attribute\s+(\w+)\s+(\w+)\s*;\s*$/;
const VARYING = /^\s*varying\s+(\w+)\s+(\w+)\s*;\s*$/;
const DROPPED = /^\s*(#version|#extension|precision\s)/;

function location(name: string): number {
  const at = VARYINGS.indexOf(name);
  if (at < 0) throw new Error(`no location for the varying ${name}`);
  return at;
}

/** One of the web's shaders restated for Impeller. */
export function flutterShader(entry: Entry): string {
  const block: string[] = [];
  const seen = new Set<string>();
  const declarations: string[] = [];
  const body: string[] = [];
  for (const line of entry.source.split('\n')) {
    if (DROPPED.test(line)) continue;
    const uniform = UNIFORM.exec(line);
    if (uniform) {
      const [, type, name, array = ''] = uniform;
      if (type === 'sampler2D') declarations.push(`uniform sampler2D ${String(name)};`);
      else if (!seen.has(String(name))) block.push(`  ${String(type)} ${String(name)}${array};`);
      seen.add(String(name));
      continue;
    }
    const attribute = ATTRIBUTE.exec(line);
    if (attribute) {
      declarations.push(`in ${String(attribute[1])} ${String(attribute[2])};`);
      continue;
    }
    const varying = VARYING.exec(line);
    if (varying) {
      const way = entry.stage === 'vertex' ? 'out' : 'in';
      const name = String(varying[2]);
      declarations.push(
        `layout(location = ${String(location(name))}) ${way} ${String(varying[1])} ${name};`,
      );
      continue;
    }
    body.push(line);
  }
  if (entry.readsTargets) block.push('  vec2 uFlip;');
  const head = [
    `// Made from the web paper turn's ${entry.name} (packages/kit/src/driver/paper);`,
    '// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.',
  ];
  if (block.length > 0) {
    head.push(
      `uniform ${entry.stage === 'vertex' ? 'VertexInfo' : 'FragmentInfo'} {`,
      ...block,
      '};',
    );
  }
  head.push(...declarations);
  if (entry.stage === 'fragment') {
    head.push('layout(location = 0) out vec4 paperColour;', '#define gl_FragColor paperColour');
    if (entry.readsTargets) {
      head.push(
        '// A texture another pass rendered, its rows as the backend stores them.',
        'vec4 readTarget(sampler2D target, vec2 at) {',
        '  return texture(target, vec2(at.x, uFlip.x + uFlip.y * at.y));',
        '}',
        '#define texture2D readTarget',
      );
    } else {
      head.push('#define texture2D texture');
    }
  }
  let text = body.join('\n');
  if (entry.stage === 'vertex') {
    if (!/void main\(\)/.test(text)) throw new Error(`${entry.name} has no main`);
    text = text.replace('void main()', 'void webMain()');
    text += [
      '',
      'void main() {',
      '  webMain();',
      "  // GL's clip depth runs -w..w, Impeller's 0..w.",
      '  gl_Position.z = 0.5 * (gl_Position.z + gl_Position.w);',
      '}',
    ].join('\n');
  }
  return `${[...head, text.trim()].join('\n')}\n`;
}

/**
 * Two programs of Flutter's own, with no web counterpart: they tell how the
 * backend stores a rendered texture's rows. The first writes, at each row,
 * where a quad pass thinks it is; the second reads that back where it
 * thinks it is and writes how far apart the two are.
 */
export const FLUTTER_PROBES: readonly { readonly name: string; readonly text: string }[] = [
  {
    name: 'RowsWrittenFragment',
    text: [
      'layout(location = 0) in vec2 vAt;',
      'layout(location = 0) out vec4 written;',
      'void main() {',
      '  written = vec4(vAt.y, 0.0, 0.0, 1.0);',
      '}',
      '',
    ].join('\n'),
  },
  {
    name: 'RowsReadFragment',
    text: [
      'uniform sampler2D uSource;',
      'layout(location = 0) in vec2 vAt;',
      'layout(location = 0) out vec4 apart;',
      'void main() {',
      '  apart = vec4(abs(texture(uSource, vAt).r - vAt.y), 0.0, 0.0, 1.0);',
      '}',
      '',
    ].join('\n'),
  },
];

/** The shader bundle flutter_gpu_shaders builds, naming each file. */
export function flutterShaderBundle(directory: string): string {
  type Listed = readonly [string, { readonly type: Stage; readonly file: string }];
  const shaders = FLUTTER_SHADERS.map(
    (entry): Listed => [entry.name, { type: entry.stage, file: `${directory}/${fileOf(entry)}` }],
  );
  const probes = FLUTTER_PROBES.map(
    (probe): Listed => [
      probe.name,
      { type: 'fragment', file: `${directory}/${fileOf({ name: probe.name, stage: 'fragment' })}` },
    ],
  );
  const bundle = Object.fromEntries([...shaders, ...probes]);
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function fileOf(entry: Pick<Entry, 'name' | 'stage'>): string {
  return `${entry.name.replace(/(Vertex|Fragment)$/, '').replace(/[A-Z]/g, (c, at: number) => (at ? '_' : '') + c.toLowerCase())}.${entry.stage === 'vertex' ? 'vert' : 'frag'}`;
}

function dartDouble(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** The light the shaders are lit by, as Dart constants. */
export function flutterLight(): string {
  const lines = [
    "// Made from the web paper turn's light.ts (packages/kit/src/driver/paper);",
    '// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.',
    '',
    "/// The light the paper turn is lit by: see the web's `light.ts`.",
    'abstract final class RitoPaperLight {',
  ];
  for (const [name, value] of Object.entries(light)) {
    const dart = name.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
    // As dart format lays them out.
    const literal = Array.isArray(value)
      ? `<double>[\n${value.map((v: number) => `    ${dartDouble(v)},\n`).join('')}  ]`
      : dartDouble(value as number);
    lines.push(
      `  static const ${Array.isArray(value) ? 'List<double>' : 'double'} ${dart} = ${literal};`,
    );
  }
  lines.push('}', '');
  return lines.join('\n');
}
