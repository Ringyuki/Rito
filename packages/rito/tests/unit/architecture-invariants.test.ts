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
const PACKAGE_JSON = join(SRC, '../package.json');
const TSDOWN_CONFIG = join(PACKAGE_ROOT, 'tsdown.config.ts');
const MAIN_ENTRY = join(SRC, 'index.ts');
const WEB_ENTRY = join(SRC, 'web.ts');
const PACKAGE_JSON_RECORD = readJsonRecord(PACKAGE_JSON);
const PUBLIC_ENTRY_FILES = packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG));
const WEB_WORKER_ADAPTER = join(SRC, 'web/reader-runtime-worker-port.ts');
const WEB_WORKER_ENDPOINT = join(SRC, 'web/reader-runtime-worker-endpoint.ts');
const WEB_WORKER_ENTRYPOINT = join(SRC, 'web/reader-runtime-worker-entry.ts');
const WEB_WORKER_DISPATCHER = join(SRC, 'web/reader-runtime-worker-dispatcher.ts');
const LAYOUT = join(SRC, 'layout');
const RENDER = join(SRC, 'render');
const RUNTIME = join(SRC, 'runtime');
const READER_SESSION = join(RUNTIME, 'reader-session');
const READER_SESSION_FRAME = join(READER_SESSION, 'frame.ts');
const RENDER_BACKENDS = join(RENDER, 'backends');
const DISPLAY_LIST = join(RENDER, 'display-list');
const RENDER_PAGE = join(RENDER, 'page');
const RENDER_SPREAD = join(RENDER, 'spread');
const RENDER_TEXT = join(RENDER, 'text');
const ASSET_CONTRACT_FILES = ['types.ts', 'image-asset-resolver.ts', 'image-sources.ts', 'bytes.ts']
  .map((file) => join(RENDER, 'assets', file))
  .filter((file) => existsSync(file));
const RENDER_ASSETS = join(RENDER, 'assets');
const RENDER_ASSET_ROOT_FILES = existsSync(RENDER_ASSETS)
  ? readdirSync(RENDER_ASSETS)
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .map((entry) => join(RENDER_ASSETS, entry))
  : [];
const LAYOUT_TYPES = join(SRC, 'layout/core/types.ts');

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
  const sourceEntries = sortedUnique(tsdownSourceEntries(tsdownConfig));
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

function packageExportLeaks(packageJson: { readonly [key: string]: unknown }): string[] {
  const exportsValue = packageJson['exports'];
  if (!isRecord(exportsValue)) return ['package.json exports must be an object'];
  const leaks: string[] = [];
  for (const [key, target] of Object.entries(exportsValue)) {
    collectPackageExportLeak(leaks, `exports.${key}`, key);
    collectPackageExportTargetLeaks(leaks, `exports.${key}`, target);
  }
  return leaks;
}

function collectPackageExportTargetLeaks(leaks: string[], path: string, value: unknown): void {
  if (typeof value === 'string') {
    collectPackageExportLeak(leaks, path, value);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, target] of Object.entries(value)) {
    collectPackageExportLeak(leaks, `${path}.${key}`, key);
    collectPackageExportTargetLeaks(leaks, `${path}.${key}`, target);
  }
}

function collectPackageExportLeak(leaks: string[], path: string, value: string): void {
  if (
    !/(?:^|\/)reader-session(?:\/|$)|runtime\/reader-session|reader-runtime-worker-/.test(value)
  ) {
    return;
  }
  leaks.push(`${path}: ${value}`);
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
const READER_SESSION_FILES = existsSync(READER_SESSION) ? walkTs(READER_SESSION) : [];
const READER_SESSION_FILE_SET = new Set(READER_SESSION_FILES);
const READER_SESSION_PROTOCOL_FILES = READER_SESSION_FILES.filter(
  (file) => file !== READER_SESSION_FRAME,
);
const LAYOUT_FILES = walkTs(LAYOUT);
const RENDER_BACKEND_FILES = existsSync(RENDER_BACKENDS) ? walkTs(RENDER_BACKENDS) : [];
const DISPLAY_LIST_FILES = existsSync(DISPLAY_LIST) ? walkTs(DISPLAY_LIST) : [];
const RENDER_PAGE_FILES = existsSync(RENDER_PAGE) ? walkTs(RENDER_PAGE) : [];
const RENDER_SPREAD_FILES = existsSync(RENDER_SPREAD) ? walkTs(RENDER_SPREAD) : [];
const PLATFORM_RUNTIME_RE =
  /\b(CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|HTMLCanvasElement|OffscreenCanvas|ImageBitmap|ImageData|FontFace|FontFaceSet|HTMLElement|Document|Window|Blob|createImageBitmap)\b/g;
const WEB_WORKER_RUNTIME_RE = /\b(Worker|MessageEvent|ErrorEvent|MessagePort)\b/g;
const READER_SESSION_DISPLAY_LIST_TYPE_IMPORT_RE =
  /^\s*import\s+type\s+.*\s+from\s+['"]\.\.\/\.\.\/render\/display-list\/types['"];?\s*$/;
const READER_SESSION_FRAME_RENDER_IMPORTS = [
  /^\s*import\s+\{\s*buildSpreadDisplayList\s*\}\s+from\s+['"]\.\.\/\.\.\/render\/display-list['"];?\s*$/,
  /^\s*import\s+\{\s*collectSpreadImageSources\s*\}\s+from\s+['"]\.\.\/\.\.\/render\/assets\/image-sources['"];?\s*$/,
  READER_SESSION_DISPLAY_LIST_TYPE_IMPORT_RE,
] as const;

describe('Architecture invariant: render/ does not import ComputedStyle', () => {
  it('no file in render/ imports the ComputedStyle type', () => {
    const hits = scan(RENDER_FILES, /import[^;]*\bComputedStyle\b[^;]*;/g);
    expect(hits, `ComputedStyle import found in:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('Architecture invariant: public entries are split by platform', () => {
  it('main entry does not export Web Canvas preset modules', () => {
    const hits = scan(
      [MAIN_ENTRY],
      /from\s+['"]\.\/(?:reader|render\/(?:index|web|page|spread|backends\/canvas|assets\/web)[^'"]*)['"]/g,
    );
    expect(
      hits,
      `Web/Canvas module leaked through main entry:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('web entry owns Web Canvas preset exports', () => {
    expect(read(WEB_ENTRY)).toContain("from './reader'");
    expect(read(WEB_ENTRY)).toContain("from './render/spread'");
    expect(read(WEB_ENTRY)).toContain("from './render/web'");
    expect(read(WEB_ENTRY)).toContain("from './render/backends/canvas'");
  });

  it('reader runtime worker adapter is not exposed through stable entries yet', () => {
    expect(existsSync(WEB_WORKER_ADAPTER)).toBe(true);
    expect(existsSync(WEB_WORKER_ENDPOINT)).toBe(true);
    expect(existsSync(WEB_WORKER_ENTRYPOINT)).toBe(true);
    expect(existsSync(WEB_WORKER_DISPATCHER)).toBe(true);
    expect(read(MAIN_ENTRY)).not.toContain('reader-runtime-worker-port');
    expect(read(MAIN_ENTRY)).not.toContain('reader-runtime-worker-endpoint');
    expect(read(MAIN_ENTRY)).not.toContain('reader-runtime-worker-entry');
    expect(read(MAIN_ENTRY)).not.toContain('reader-runtime-worker-dispatcher');
    expect(read(WEB_ENTRY)).not.toContain('reader-runtime-worker-port');
    expect(read(WEB_ENTRY)).not.toContain('reader-runtime-worker-endpoint');
    expect(read(WEB_ENTRY)).not.toContain('reader-runtime-worker-entry');
    expect(read(WEB_ENTRY)).not.toContain('reader-runtime-worker-dispatcher');
    expect(read(join(RUNTIME, 'index.ts'))).not.toContain('reader-runtime-worker-port');
    expect(read(join(RUNTIME, 'index.ts'))).not.toContain('reader-runtime-worker-endpoint');
    expect(read(join(RUNTIME, 'index.ts'))).not.toContain('reader-runtime-worker-entry');
    expect(read(join(RUNTIME, 'index.ts'))).not.toContain('reader-runtime-worker-dispatcher');
  });

  it('reader runtime internals are not exposed through package entrypoints yet', () => {
    const hits = scan(
      PUBLIC_ENTRY_FILES,
      /reader-session|reader-runtime-worker-(?:port|endpoint|entry|dispatcher)/g,
    );
    expect(
      hits,
      `Reader runtime internals leaked through public entries:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
    const exportedEntryFiles = [...PUBLIC_ENTRY_FILES].sort();
    expect(exportedEntryFiles).toEqual(
      packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG)),
    );
    const exportLeaks = packageExportLeaks(PACKAGE_JSON_RECORD);
    expect(
      exportLeaks,
      `Reader runtime internals leaked through package exports:\n${JSON.stringify(
        exportLeaks,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader runtime worker entry does not bind to a global worker scope', () => {
    const text = read(WEB_WORKER_ENTRYPOINT);
    expect(text).not.toContain('self');
    expect(text).not.toContain('DedicatedWorkerGlobalScope');
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
    expect(files).toEqual(['render/page/index.ts']);
  });

  it('render/spread is only the public spread facade', () => {
    const files = RENDER_SPREAD_FILES.map(rel).sort();
    expect(files).toEqual(['render/spread/index.ts']);
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

  it('only imports approved platform-neutral render contracts from reader-session', () => {
    const hits = scanRenderImports(RUNTIME_FILES, (file, line) => {
      if (!READER_SESSION_FILE_SET.has(file)) return false;
      if (file === READER_SESSION_FRAME) {
        return READER_SESSION_FRAME_RENDER_IMPORTS.some((pattern) => pattern.test(line));
      }
      return READER_SESSION_DISPLAY_LIST_TYPE_IMPORT_RE.test(line);
    });
    expect(hits, `runtime imported render modules:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('Architecture invariant: reader-session protocol stays neutral and internal', () => {
  it('protocol files only import render/display-list/types with type-only syntax', () => {
    const hits = scanRenderImports(READER_SESSION_PROTOCOL_FILES, (_file, line) => {
      return READER_SESSION_DISPLAY_LIST_TYPE_IMPORT_RE.test(line);
    });
    expect(
      hits,
      `reader-session protocol imported render implementation modules:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('frame builder only imports approved platform-neutral render modules', () => {
    const hits = scanRenderImports([READER_SESSION_FRAME], (_file, line) => {
      return READER_SESSION_FRAME_RENDER_IMPORTS.some((pattern) => pattern.test(line));
    });
    expect(
      hits,
      `frame builder imported disallowed render modules:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not import Web Canvas adapters, render backends, or Web render helpers', () => {
    const hits = scan(
      READER_SESSION_FILES,
      /from\s+['"][^'"]*render(?:\/(?:index|web|page|spread|backends|assets\/web)(?:\/[^'"]*)?)?['"]/g,
    );
    expect(
      hits,
      `reader-session imported a platform render module:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not reference browser or canvas runtime types', () => {
    const hits = scan(READER_SESSION_FILES, PLATFORM_RUNTIME_RE);
    expect(
      hits,
      `Platform type found in reader-session:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not reference Web Worker runtime types', () => {
    const hits = scan(READER_SESSION_FILES, WEB_WORKER_RUNTIME_RE);
    expect(
      hits,
      `Web Worker runtime type found in reader-session:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('is not exposed through stable public entries yet', () => {
    expect(read(MAIN_ENTRY)).not.toContain('reader-session');
    expect(read(join(RUNTIME, 'index.ts'))).not.toContain('reader-session');
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
