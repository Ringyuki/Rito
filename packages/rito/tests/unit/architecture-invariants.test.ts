/**
 * Architecture invariants for the `@ritojs/core` package surface.
 *
 * The engine is the Rust core behind `@ritojs/core-wasm`; this package is
 * its browser binding plus a thin public reader facade. These tests pin
 * that shape at the source-text level so a stray engine-level module, a
 * second public entry, or an app importing package internals fails CI
 * before it lands.
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
  'src/bindings/browser/reader-session-worker.ts',
]);
const MAIN_ENTRY = join(SRC, 'index.ts');
const PACKAGE_JSON_RECORD = readJsonRecord(PACKAGE_JSON);
const PUBLIC_ENTRY_FILES = packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG));
const READER_ROOT = join(SRC, 'reader');
const BROWSER_READER_BINDING = join(SRC, 'bindings/browser/reader');
const BROWSER_READER_BINDING_ROOT = join(BROWSER_READER_BINDING, 'reader.ts');
const READER_CONSUMER_ROOTS = [
  join(WORKSPACE_ROOT, 'packages/kit/src'),
  join(WORKSPACE_ROOT, 'packages/react/src'),
  join(WORKSPACE_ROOT, 'apps/reader/src'),
].filter((path) => existsSync(path));
// Directory names the retired TypeScript engine used for its layout,
// style, parser and render authorities. None of them may reappear as a
// source root: the engine lives in the Rust crates.
const ENGINE_ROOT_NAMES = [
  'compatibility',
  'dom',
  'interaction',
  'layout',
  'model',
  'parser',
  'reference',
  'render',
  'runtime',
  'style',
  'utils',
];

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
function scan(files: readonly string[], pattern: RegExp): { file: string; match: string }[] {
  const hits: { file: string; match: string }[] = [];
  for (const file of files) {
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

const READER_CONSUMER_FILES = READER_CONSUMER_ROOTS.flatMap(walkTsLike);

describe('Architecture invariant: one public entry, one engine', () => {
  it('main entry exposes the root reader without engine or Canvas helper modules', () => {
    const source = read(MAIN_ENTRY);
    for (const name of ENGINE_ROOT_NAMES) {
      expect(source, `main entry imports ./${name}/`).not.toContain(`from './${name}/`);
      expect(source, `main entry imports ./${name}`).not.toContain(`from './${name}'`);
    }
  });

  it('the package exposes only the root entry', () => {
    const exported = Object.keys(PACKAGE_JSON_RECORD['exports'] as Record<string, unknown>);
    expect(exported.sort()).toEqual(['.', './package.json']);
    expect(read(TSDOWN_CONFIG)).not.toMatch(
      /src\/(?:advanced|web|selection|search|annotations|position|a11y|dom|reference)\.ts/,
    );
  });

  it('package exports and build entries stay aligned', () => {
    expect([...PUBLIC_ENTRY_FILES].sort()).toEqual(
      packageSourceEntryFiles(PACKAGE_JSON_RECORD, read(TSDOWN_CONFIG)),
    );
  });

  it('no engine-level source root exists in the package', () => {
    const hits = ENGINE_ROOT_NAMES.map((name) => join(SRC, name)).filter(existsSync);
    expect(
      hits.map(rel),
      `Engine-level directories leaked into the browser binding package:\n${JSON.stringify(
        hits.map(rel),
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader UI packages consume the root core reader entry', () => {
    const hits = scan(
      READER_CONSUMER_FILES,
      /(?:from\s+|import\s*\()\s*['"]@ritojs\/core\/(?:advanced|web|selection|search|annotations|position|a11y|dom|reference)['"]/g,
    );
    expect(
      hits,
      `App-facing reader code should not import @ritojs/core subpaths:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader UI packages do not reach into package sources', () => {
    const hits = scan(
      READER_CONSUMER_FILES,
      /(?:from\s+|import\s*\()\s*['"][^'"]*packages\/rito\/src[^'"]*['"]/g,
    );
    expect(
      hits,
      `App-facing reader code should not import @ritojs/core sources:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('reader UI packages keep the interaction helpers owned by kit', () => {
    const kitInteraction = join(WORKSPACE_ROOT, 'packages/kit/src/interaction');
    expect(existsSync(kitInteraction)).toBe(true);
    expect(read(join(WORKSPACE_ROOT, 'packages/kit/src/controller/engines/create.ts'))).toContain(
      '../../interaction/index',
    );
  });
});

describe('Architecture invariant: the reader facade stays thin', () => {
  it('production reader directory is a thin public facade', () => {
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

  it('loads the runtime boundary and lets worker selection choose the execution mode', () => {
    const source = read(BROWSER_READER_BINDING_ROOT);

    expect(source).toContain('loadRuntimeCoreModule');
    expect(source).not.toContain('initializeFullCoreModule');
    expect(source).not.toContain('getLoadedFullCoreModule');
    expect(source).not.toContain('createInProcessBrowserReaderWorkerClient');
  });
});

describe('Architecture invariant: retired shapes stay retired', () => {
  // The pre-Rust layout node shapes; nothing may re-introduce them under
  // the same name somewhere new.
  const BANNED_TYPES = [
    'BlockBorders',
    'BlockBorderEdge',
    'RelativeOffset',
    'LayoutBlock',
    'TextRun',
    'LineBox',
  ] as const;

  for (const name of BANNED_TYPES) {
    it(`type "${name}" is not defined anywhere in src/`, () => {
      const files = walkTs(SRC);
      const re = new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`, 'g');
      const hits = scan(files, re);
      expect(hits, `${name} was re-introduced:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});
