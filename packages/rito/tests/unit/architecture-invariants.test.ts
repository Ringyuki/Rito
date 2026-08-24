/**
 * Architecture invariants (post-Phase 2).
 *
 * These tests enforce the layout / render boundary at the source-text level.
 * They are a safety net against regressions — any change that re-introduces
 * a violated pattern should fail CI before it lands.
 *
 * The invariants come from the post-Phase-2 layout / render boundary
 * documented in AGENTS.md and encoded by the paint-ready layout types:
 *  1. layout produces paint-ready data; render only consumes it
 *  2. render does no CSS string parsing or semantic derivation
 *  3. each piece of info is produced in exactly one place
 *  4. render-only fields live on paint sub-objects, not layout node top-levels
 *
 * See AGENTS.md "Layout / Render boundary" for the same rules in prose.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const PACKAGE_ROOT = join(SRC, '..');
const WORKSPACE_ROOT = join(PACKAGE_ROOT, '../..');
const PACKAGE_JSON = join(SRC, '../package.json');
const TSDOWN_CONFIG = join(PACKAGE_ROOT, 'tsdown.config.ts');
const PRIVATE_BUILD_ENTRIES = new Set([
  'src/bindings/browser/reader/worker-main.ts',
  'src/bindings/browser/reader-v1-worker.ts',
]);
const MAIN_ENTRY = join(SRC, 'index.ts');
const PACKAGE_JSON_RECORD = readJsonRecord(PACKAGE_JSON);
const PUBLIC_ENTRY_FILES = packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG));
const REFERENCE = join(SRC, 'reference');
const REFERENCE_TS_CORE = join(REFERENCE, 'ts-core');
const COMPATIBILITY = join(SRC, 'compatibility');
const LAYOUT = join(REFERENCE_TS_CORE, 'layout');
const RENDER = join(REFERENCE_TS_CORE, 'render');
const RUNTIME = join(REFERENCE_TS_CORE, 'runtime');
const READER_ROOT = join(SRC, 'reader');
const BROWSER_READER_BINDING = join(SRC, 'bindings/browser/reader');
const BROWSER_READER_BINDING_ROOT = join(BROWSER_READER_BINDING, 'reader.ts');
const RENDER_BACKENDS = join(RENDER, 'backends');
const DISPLAY_LIST = join(RENDER, 'display-list');
const RENDER_PAGE = join(RENDER, 'page');
const RENDER_SPREAD = join(RENDER, 'spread');
const RENDER_TEXT = join(RENDER, 'text');
const ASSET_CONTRACT_FILES = ['types.ts', 'image-asset-resolver.ts', 'image-sources.ts', 'bytes.ts']
  .map((file) => join(RENDER, 'assets', file))
  .filter((file) => existsSync(file));
const RENDER_ASSETS = join(RENDER, 'assets');
const READER_CONSUMER_ROOTS = [
  join(WORKSPACE_ROOT, 'packages/kit/src'),
  join(WORKSPACE_ROOT, 'packages/react/src'),
  join(WORKSPACE_ROOT, 'apps/reader/src'),
].filter((path) => existsSync(path));
const LEGACY_TS_CORE_ROOTS = [
  'dom',
  'interaction',
  'layout',
  'model',
  'parser',
  'render',
  'runtime',
  'style',
  'utils',
].map((dir) => join(SRC, dir));
const RENDER_ASSET_ROOT_FILES = existsSync(RENDER_ASSETS)
  ? readdirSync(RENDER_ASSETS)
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .map((entry) => join(RENDER_ASSETS, entry))
  : [];
const LAYOUT_TYPES = join(REFERENCE_TS_CORE, 'layout/core/types.ts');

function walkTs(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function walkTsLike(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsLike(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function readJsonRecord(path: string): { readonly [key: string]: unknown } {
  const parsed: unknown = JSON.parse(read(path));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as { readonly [key: string]: unknown };
}

function rel(path: string): string {
  return relative(SRC, path).split(sep).join('/');
}

/** Return all substring matches of `pattern` paired with the file that
 *  produced them. */
function scan(
  files: readonly string[],
  pattern: RegExp,
  skipFile?: (path: string) => boolean,
): { file: string; match: string }[] {
  const hits: { file: string; match: string }[] = [];
  for (const file of files) {
    if (skipFile?.(file)) continue;
    const text = read(file);
    for (const m of text.matchAll(pattern)) {
      hits.push({ file: rel(file), match: m[0] });
    }
  }
  return hits;
}

function packageSourceEntryFiles(
  packageJson: { readonly [key: string]: unknown },
  tsdownConfig: string,
): string[] {
  const exportsValue = packageJson['exports'];
  if (!isRecord(exportsValue)) throw new Error('package.json exports must be an object');
  const sourceEntries = sortedUnique(
    tsdownSourceEntries(tsdownConfig).filter((entry) => !PRIVATE_BUILD_ENTRIES.has(entry)),
  );
  const exportEntries = sortedUnique(packageExportSourceEntries(exportsValue));
  const expected = exportEntries.filter((entry) => entry !== 'package.json');
  if (!sameStringList(sourceEntries, expected)) {
    throw new Error(
      `package.json exports and tsdown entries disagree:\nexports=${JSON.stringify(
        expected,
      )}\ntsdown=${JSON.stringify(sourceEntries)}`,
    );
  }
  return sourceEntries.map((entry) => join(PACKAGE_ROOT, entry));
}

function tsdownSourceEntries(config: string): string[] {
  const matches = [...config.matchAll(/['"]src\/([^'"]+\.ts)['"]/g)];
  return matches.map((match) => {
    const entry = match[1];
    if (entry === undefined) throw new Error('Malformed tsdown entry');
    return `src/${entry}`;
  });
}

function packageExportSourceEntries(exportsValue: { readonly [key: string]: unknown }): string[] {
  const entries: string[] = [];
  for (const [key, target] of Object.entries(exportsValue)) {
    if (key === './package.json') {
      entries.push('package.json');
      continue;
    }
    const importTarget = packageExportImportTarget(target);
    if (importTarget === undefined) {
      throw new Error(`package export ${key} is missing an import target`);
    }
    entries.push(distTargetToSourceEntry(importTarget));
  }
  return entries;
}

function packageExportImportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const importValue = value['import'];
  return typeof importValue === 'string' ? importValue : undefined;
}

function distTargetToSourceEntry(target: string): string {
  const match = /^\.\/dist\/([^/]+)\.mjs$/.exec(target);
  if (match?.[1] === undefined) {
    throw new Error(`package export target ${target} is not a dist entry`);
  }
  return `src/${match[1]}.ts`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scanRenderImports(
  files: readonly string[],
  allow?: (path: string, line: string) => boolean,
): { file: string; line: number; match: string }[] {
  const hits: { file: string; line: number; match: string }[] = [];
  const detector = /from\s+['"][^'"]*render[^'"]*['"]/;
  for (const file of files) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      if (!detector.test(line)) return;
      if (allow?.(file, line)) return;
      hits.push({ file: rel(file), line: index + 1, match: line.trim() });
    });
  }
  return hits;
}

const RENDER_FILES = walkTs(RENDER);
const RUNTIME_FILES = walkTs(RUNTIME);
const REFERENCE_FILES = existsSync(REFERENCE) ? walkTs(REFERENCE) : [];
const BROWSER_READER_BINDING_FILES = existsSync(BROWSER_READER_BINDING)
  ? walkTs(BROWSER_READER_BINDING)
  : [];
const LAYOUT_FILES = walkTs(LAYOUT);
const RENDER_BACKEND_FILES = existsSync(RENDER_BACKENDS) ? walkTs(RENDER_BACKENDS) : [];
const DISPLAY_LIST_FILES = existsSync(DISPLAY_LIST) ? walkTs(DISPLAY_LIST) : [];
const RENDER_PAGE_FILES = existsSync(RENDER_PAGE) ? walkTs(RENDER_PAGE) : [];
const RENDER_SPREAD_FILES = existsSync(RENDER_SPREAD) ? walkTs(RENDER_SPREAD) : [];
const PLATFORM_RUNTIME_RE =
  /\b(CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|HTMLCanvasElement|OffscreenCanvas|ImageBitmap|ImageData|FontFace|FontFaceSet|HTMLElement|Document|Window|Blob|createImageBitmap)\b/g;
const READER_CONSUMER_FILES = READER_CONSUMER_ROOTS.flatMap(walkTsLike);

function isLegacyTsCoreRootFile(file: string): boolean {
  return LEGACY_TS_CORE_ROOTS.some((root) => file.startsWith(`${root}${sep}`));
}

function isReferenceShim(file: string): boolean {
  return /^export \* from "(\.\.\/)+reference\/ts-core\/[^"]+";\n?$/.test(read(file));
}

describe('Architecture invariant: render/ does not import ComputedStyle', () => {
  it('no file in render/ imports the ComputedStyle type', () => {
    const hits = scan(RENDER_FILES, /import[^;]*\bComputedStyle\b[^;]*;/g);
    expect(hits, `ComputedStyle import found in:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('Architecture invariant: public entries are split by platform', () => {
  it('main entry exposes the root reader without Web Canvas helper modules', () => {
    const hits = scan(
      [MAIN_ENTRY],
      /from\s+['"]\.\/render\/(?:index|web|page|spread|backends\/canvas|assets\/web)[^'"]*['"]/g,
    );
    expect(
      hits,
      `Web/Canvas module leaked through main entry:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('main entry value-exports only the production reader facade', () => {
    const hits = scan(
      [MAIN_ENTRY],
      /export\s+(?!type\b)[^;]*from\s+['"]\.\/(?:reference|compatibility\/web)['"]/g,
    );
    expect(
      hits,
      `Legacy TS reader value export leaked through main entry:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('main entry does not expose legacy TypeScript primitive modules', () => {
    const source = read(MAIN_ENTRY);
    expect(source).not.toContain("from './compatibility/");
    expect(source).not.toContain("from './runtime/");
    expect(source).not.toContain("from './layout/");
    expect(source).not.toContain("from './render/");
    expect(source).not.toContain("from './parser/");
  });

  it('legacy TypeScript compatibility subpaths are not public package entries', () => {
    const exported = Object.keys(PACKAGE_JSON_RECORD['exports'] as Record<string, unknown>);
    expect(exported.sort()).toEqual(['.', './package.json']);
    expect(read(TSDOWN_CONFIG)).not.toMatch(
      /src\/(?:advanced|web|selection|search|annotations|position|a11y|dom)\.ts/,
    );
  });

  it('legacy TypeScript compatibility code stays source-only for reference and golden tooling', () => {
    expect(read(join(COMPATIBILITY, 'web.ts'))).toContain("from '../reference'");
    expect(read(join(COMPATIBILITY, 'advanced.ts'))).toContain("from '../reference/ts-core/");
  });

  it('package exports do not expose the internal reference implementation', () => {
    const exportsText = JSON.stringify(PACKAGE_JSON_RECORD['exports']);
    expect(exportsText).not.toContain('reference');
  });

  it('package exports and build entries stay aligned', () => {
    expect([...PUBLIC_ENTRY_FILES].sort()).toEqual(
      packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG)),
    );
  });

  it('reader UI packages consume the root core reader entry', () => {
    const hits = scan(
      READER_CONSUMER_FILES,
      /(?:from\s+|import\s*\()\s*['"]@ritojs\/core\/(?:advanced|web|selection|search|annotations|position|a11y|dom)['"]/g,
    );
    expect(
      hits,
      `App-facing reader code should not import removed @ritojs/core legacy subpaths:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader UI packages do not consume the internal reference implementation', () => {
    const hits = scan(
      READER_CONSUMER_FILES,
      /(?:from\s+|import\s*\()\s*['"][^'"]*(?:@ritojs\/core\/reference|\/reference|src\/reference)[^'"]*['"]/g,
    );
    expect(
      hits,
      `App-facing reader code should not import TS reference internals:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader UI packages keep old TypeScript interaction helpers owned by kit', () => {
    const kitInteraction = join(WORKSPACE_ROOT, 'packages/kit/src/interaction');
    expect(existsSync(kitInteraction)).toBe(true);
    expect(read(join(WORKSPACE_ROOT, 'packages/kit/src/controller/engines/create.ts'))).toContain(
      '../../interaction/index',
    );
  });
});

describe('Architecture invariant: TypeScript reference core is isolated', () => {
  it('reference facade exists and owns the legacy TypeScript reader implementation', () => {
    const files = REFERENCE_FILES.map(rel).sort();
    expect(existsSync(REFERENCE_TS_CORE)).toBe(true);
    expect(files).toContain('reference/index.ts');
    expect(files).toContain('reference/reader/index.ts');
    expect(files.some((file) => file.startsWith('reference/reader/helpers/'))).toBe(true);
    expect(files.some((file) => file.startsWith('reference/ts-core/layout/'))).toBe(true);
    expect(files.some((file) => file.startsWith('reference/ts-core/render/'))).toBe(true);
    expect(files.some((file) => file.startsWith('reference/ts-core/runtime/'))).toBe(true);
  });

  it('legacy TypeScript core root directories are not implementation roots', () => {
    const hits = LEGACY_TS_CORE_ROOTS.filter(existsSync);
    expect(
      hits.map(rel),
      `Legacy TS implementation directories leaked back into root source:\n${JSON.stringify(
        hits.map(rel),
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('production reader directory does not contain legacy TypeScript reader helpers', () => {
    const files = walkTs(READER_ROOT).map(rel).sort();
    const hits = files.filter((file) => file.startsWith('reader/helpers/'));
    expect(
      hits,
      `Legacy TypeScript reader helpers leaked into production reader directory:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('production reader directory stays a thin public facade', () => {
    expect(walkTs(READER_ROOT).map(rel).sort()).toEqual([
      'reader/create-reader.ts',
      'reader/index.ts',
      'reader/instance.ts',
      'reader/layout-config.ts',
      'reader/model.ts',
    ]);
  });

  it('root reader facade lazy-loads the browser binding implementation', () => {
    const source = read(join(READER_ROOT, 'create-reader.ts'));
    expect(source).not.toMatch(/from\s+['"][^'"]*bindings\/browser\/reader/);
    expect(source).toContain("import('../bindings/browser/reader/reader')");
  });

  it('main entry and browser reader binding do not import the reference core', () => {
    const hits = scan(
      [MAIN_ENTRY, ...BROWSER_READER_BINDING_FILES],
      /from\s+['"][^'"]*reference[^'"]*['"]|import\s*\(\s*['"][^'"]*reference[^'"]*['"]\s*\)/g,
    );
    expect(
      hits,
      `Production reader binding imported reference internals:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('only compatibility and reference code may import the reference core', () => {
    const productionFiles = walkTs(SRC).filter((file) => {
      if (file.startsWith(REFERENCE) || file.startsWith(COMPATIBILITY)) return false;
      if (isLegacyTsCoreRootFile(file) && isReferenceShim(file)) return false;
      return true;
    });
    const hits = scan(
      productionFiles,
      /from\s+['"][^'"]*reference[^'"]*['"]|import\s*\(\s*['"][^'"]*reference[^'"]*['"]\s*\)/g,
    );
    expect(
      hits,
      `Production code imported reference internals outside compatibility:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });
});

describe('Architecture invariant: root reader does not force main-thread engine execution', () => {
  it('loads the runtime boundary and lets worker selection choose the execution mode', () => {
    const source = read(BROWSER_READER_BINDING_ROOT);

    expect(source).toContain('loadRuntimeCoreModule');
    expect(source).not.toContain('initializeFullCoreModule');
    expect(source).not.toContain('getLoadedFullCoreModule');
    expect(source).not.toContain('createInProcessBrowserReaderWorkerClient');
  });
});

describe('Architecture invariant: display-list is platform-neutral', () => {
  it('does not reference browser or canvas runtime types', () => {
    const hits = scan(DISPLAY_LIST_FILES, PLATFORM_RUNTIME_RE);
    expect(hits, `Platform type found in display-list:\n${JSON.stringify(hits, null, 2)}`).toEqual(
      [],
    );
  });

  it('does not import ComputedStyle', () => {
    const hits = scan(DISPLAY_LIST_FILES, /import[^;]*\bComputedStyle\b[^;]*;/g);
    expect(
      hits,
      `ComputedStyle import found in display-list:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });
});

describe('Architecture invariant: render backends consume display-list commands', () => {
  it('do not depend on layout node shapes', () => {
    const hits = scan(
      RENDER_BACKEND_FILES,
      /\b(LayoutBlock|TextRun|RubyAnnotation|LineBox|InlineAtom|HorizontalRule)\b/g,
    );
    expect(hits, `Backend referenced layout node types:\n${JSON.stringify(hits, null, 2)}`).toEqual(
      [],
    );
  });
});

describe('Architecture invariant: Canvas implementation lives in the Canvas backend', () => {
  it('render/page is only the public page facade', () => {
    const files = RENDER_PAGE_FILES.map(rel).sort();
    expect(files).toEqual(['reference/ts-core/render/page/index.ts']);
  });

  it('render/spread is only the public spread facade', () => {
    const files = RENDER_SPREAD_FILES.map(rel).sort();
    expect(files).toEqual(['reference/ts-core/render/spread/index.ts']);
  });

  it('page and spread facades do not perform raw Canvas drawing', () => {
    const facadeFiles = [...RENDER_PAGE_FILES, ...RENDER_SPREAD_FILES];
    const hits = scan(
      facadeFiles,
      /\bctx\.(save|restore|scale|translate|fillStyle|fillRect|drawImage|clip|rect|fillText|stroke)\b/g,
    );
    expect(
      hits,
      `Canvas drawing leaked into render facades:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('render/text does not contain backend text helpers', () => {
    expect(existsSync(RENDER_TEXT)).toBe(false);
  });
});

describe('Architecture invariant: runtime is platform-neutral', () => {
  it('does not reference browser or canvas runtime types', () => {
    const hits = scan(RUNTIME_FILES, PLATFORM_RUNTIME_RE);
    expect(hits, `Platform type found in runtime:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  it('does not import render modules', () => {
    const hits = scanRenderImports(RUNTIME_FILES);
    expect(hits, `runtime imported render modules:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('Architecture invariant: layout text measurement is platform-neutral', () => {
  it('does not import render modules', () => {
    const hits = scan(LAYOUT_FILES, /from\s+['"][^'"]*render[^'"]*['"]/g);
    expect(hits, `layout imported render modules:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  it('does not reference canvas runtime types or font-string serializers', () => {
    const hits = scan(
      LAYOUT_FILES,
      /\b(CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|OffscreenCanvas|buildFontString)\b/g,
    );
    expect(
      hits,
      `Platform text measurement leaked into layout:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });
});

describe('Architecture invariant: asset contracts are platform-neutral', () => {
  it('does not reference browser or canvas runtime types', () => {
    const hits = scan(ASSET_CONTRACT_FILES, PLATFORM_RUNTIME_RE);
    expect(
      hits,
      `Platform type found in asset contracts:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });
});

describe('Architecture invariant: asset root stays platform-neutral', () => {
  it('does not reference browser or canvas runtime types outside assets/web', () => {
    const hits = scan(RENDER_ASSET_ROOT_FILES, PLATFORM_RUNTIME_RE);
    expect(
      hits,
      `Platform runtime found in render/assets root:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not import Web adapters or render backends from asset root implementations', () => {
    const hits = scan(
      RENDER_ASSET_ROOT_FILES,
      /from\s+['"](\.\/web|..\/backends|..\/..\/render\/backends)[^'"]*['"]/g,
    );
    expect(
      hits,
      `Platform adapter import found in render/assets root:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });
});

describe('Architecture invariant: render/ does not read removed TextRun fields', () => {
  // Phase 2 removed these TextRun fields in favour of run.paint.* / independent
  // RubyAnnotation nodes / paint.border.start|end.
  const BANNED_RUN_FIELDS = ['style', 'rubyAnnotation', 'borderStart', 'borderEnd'] as const;

  for (const field of BANNED_RUN_FIELDS) {
    it(`run.${field} is never accessed in render/`, () => {
      // Match `.field` but require a word boundary and not a chained leaf we care about.
      // Specifically `run.style` / `textRun.style` / `run.rubyAnnotation` / etc.
      const re = new RegExp(`\\b(run|textRun)\\.${field}\\b`, 'g');
      const hits = scan(RENDER_FILES, re);
      expect(hits, `Found reads of run.${field}:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});

describe('Architecture invariant: render/ does not read removed LayoutBlock fields', () => {
  const BANNED_BLOCK_FIELDS = [
    'backgroundColor',
    'backgroundImage',
    'backgroundSize',
    'backgroundRepeat',
    'backgroundPosition',
    'borderRadius',
    'borderRadiusPct',
    'opacity',
    'boxShadow',
    'transform',
    'overflow',
    'relativeOffset',
    'borders',
  ] as const;

  for (const field of BANNED_BLOCK_FIELDS) {
    it(`block.${field} is never read in render/`, () => {
      // Only flag direct `block.field` reads (not `block.paint.field` etc.).
      const re = new RegExp(`\\bblock\\.${field}\\b`, 'g');
      const hits = scan(RENDER_FILES, re);
      expect(hits, `Found reads of block.${field}:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});

describe('Architecture invariant: render/ does not parse CSS strings', () => {
  // We ban the three primitives that appeared in the pre-Phase-2 render-side
  // CSS parsers (transform regex, backgroundPosition split, custom RegExp).
  // Legitimate non-CSS uses on user text must mark themselves with an
  // `ARCH-ALLOW:` comment on the SAME line or the line immediately before.
  //
  // This is intentionally narrower than "no regex literals" — we tested that
  // broader rule and it hit too many false-positives on `../` import paths.
  // The three checks below cover every pattern the original violations used.

  const BANNED: { name: string; detector: RegExp }[] = [
    { name: '.split(', detector: /\.split\(/ },
    { name: 'new RegExp(', detector: /\bnew\s+RegExp\s*\(/ },
    {
      name: 'TRANSFORM_FN_RE / similar module-level CSS regex',
      detector: /^\s*const\s+[A-Z_]+_RE\s*=\s*\//m,
    },
  ];

  for (const { name, detector } of BANNED) {
    it(`no unannotated ${name} in render/`, () => {
      const hits: { file: string; line: number; match: string }[] = [];
      for (const file of RENDER_FILES) {
        const text = read(file);
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (!detector.test(line)) return;
          if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
          const prev = i > 0 ? (lines[i - 1] ?? '') : '';
          if (line.includes('ARCH-ALLOW:') || prev.includes('ARCH-ALLOW:')) return;
          hits.push({ file: rel(file), line: i + 1, match: line.trim() });
        });
      }
      expect(hits, `Unannotated "${name}" in render/:\n${JSON.stringify(hits, null, 2)}`).toEqual(
        [],
      );
    });
  }
});

describe('Architecture invariant: LayoutBlock and TextRun shape', () => {
  // Parse the interface body out of layout/core/types.ts and count readonly
  // fields. This is a string match, not a TS-AST walk — good enough for a
  // regression guard, cheap to maintain.
  function extractInterface(name: string): string {
    const text = read(LAYOUT_TYPES);
    const re = new RegExp(`export interface ${name}\\s*{([\\s\\S]*?)\\n}`, 'm');
    const m = re.exec(text);
    if (!m) throw new Error(`Interface ${name} not found in layout/core/types.ts`);
    return m[1] ?? '';
  }

  function readonlyFieldNames(body: string): string[] {
    // Match `readonly <name>` (optionally `?`) and capture the name.
    const names: string[] = [];
    for (const m of body.matchAll(/^\s*readonly\s+([a-zA-Z_]\w*)\??:/gm)) {
      if (m[1]) names.push(m[1]);
    }
    return names;
  }

  it('LayoutBlock has exactly 11 top-level fields', () => {
    const body = extractInterface('LayoutBlock');
    const fields = readonlyFieldNames(body);
    const expected = [
      'type',
      'bounds',
      'children',
      'anchorId',
      'semanticTag',
      'borderBox',
      'pageBreakBefore',
      'pageBreakAfter',
      'orphans',
      'widows',
      'paint',
    ].sort();
    expect(fields.slice().sort()).toEqual(expected);
  });

  it('TextRun does not carry style / rubyAnnotation / borderStart / borderEnd', () => {
    const body = extractInterface('TextRun');
    const fields = readonlyFieldNames(body);
    for (const banned of ['style', 'rubyAnnotation', 'borderStart', 'borderEnd']) {
      expect(fields, `TextRun.${banned} should not exist`).not.toContain(banned);
    }
  });

  it('TextRun requires paint: RunPaint', () => {
    const body = extractInterface('TextRun');
    expect(body).toMatch(/readonly\s+paint\s*:\s*RunPaint/);
  });

  it('HorizontalRule carries paint: HrPaint (no top-level color / borderStyle)', () => {
    const body = extractInterface('HorizontalRule');
    const fields = readonlyFieldNames(body);
    expect(fields).toContain('paint');
    expect(fields).not.toContain('color');
    expect(fields).not.toContain('borderStyle');
  });

  it('Page carries paint?: PagePaint (no top-level bodyBackgroundColor)', () => {
    const body = extractInterface('Page');
    const fields = readonlyFieldNames(body);
    expect(fields).toContain('paint');
    expect(fields).not.toContain('bodyBackgroundColor');
  });

  it('InlineAtom does not carry verticalAlign', () => {
    const body = extractInterface('InlineAtom');
    const fields = readonlyFieldNames(body);
    expect(fields).not.toContain('verticalAlign');
  });
});

describe('Architecture invariant: deleted types stay deleted', () => {
  // Guard against anyone re-introducing the pre-Phase-2 shape under the same
  // name somewhere new.
  const BANNED_TYPES = ['BlockBorders', 'BlockBorderEdge', 'RelativeOffset'] as const;

  for (const name of BANNED_TYPES) {
    it(`type "${name}" is not defined anywhere in src/`, () => {
      const files = walkTs(SRC);
      const re = new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`, 'g');
      const hits = scan(files, re);
      expect(hits, `${name} was re-introduced:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});
