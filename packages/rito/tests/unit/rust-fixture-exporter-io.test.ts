import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

interface FixtureWriteInput {
  readonly check: boolean;
  readonly outputRoot: string;
  readonly relativePath: string;
  readonly text: string;
}

interface FixtureIoModule {
  readonly writeCanonicalFixture: (input: FixtureWriteInput) => Promise<'unchanged' | 'written'>;
}

interface XhtmlNormalizationModule {
  readonly normalizeParseResult: (result: {
    readonly bodyAttributes?: unknown;
    readonly embeddedStylesheets?: readonly string[];
    readonly nodes: readonly unknown[];
    readonly stylesheetHrefs?: readonly string[];
    readonly warnings: readonly string[];
  }) => Record<string, unknown>;
}

const PACKAGE_ROOT = join(import.meta.dirname, '../..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('Rust fixture exporter IO', () => {
  it('checks canonical gzip payloads and retains compressor-specific bytes', async () => {
    const fixtureIo = await loadFixtureIo();
    const outputRoot = await createTemporaryRoot();
    const relativePath = 'book/default.json.gz';
    const fixturePath = join(outputRoot, relativePath);
    const canonical = '{\n  "answer": 42\n}\n';
    const existing = gzipSync(Buffer.from(canonical), { level: 1 });
    expect(existing.equals(gzipSync(Buffer.from(canonical), { level: 9 }))).toBe(false);
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, existing);

    await expect(
      fixtureIo.writeCanonicalFixture({
        check: true,
        outputRoot,
        relativePath,
        text: canonical,
      }),
    ).resolves.toBe('unchanged');
    await expect(
      fixtureIo.writeCanonicalFixture({
        check: false,
        outputRoot,
        relativePath,
        text: canonical,
      }),
    ).resolves.toBe('unchanged');
    expect(await readFile(fixturePath)).toEqual(existing);

    const changed = '{\n  "answer": 43\n}\n';
    await expect(
      fixtureIo.writeCanonicalFixture({
        check: false,
        outputRoot,
        relativePath,
        text: changed,
      }),
    ).resolves.toBe('written');
    expect(gunzipSync(await readFile(fixturePath)).toString('utf8')).toBe(changed);
  });

  it('preserves missing stylesheet metadata separately from explicit empty lists', async () => {
    const normalization = await loadXhtmlNormalization();
    const base = { nodes: [], warnings: [] };

    expect(normalization.normalizeParseResult(base)).toMatchObject({
      embeddedStylesheets: null,
      stylesheetHrefs: null,
    });
    expect(
      normalization.normalizeParseResult({
        ...base,
        embeddedStylesheets: [],
        stylesheetHrefs: [],
      }),
    ).toMatchObject({ embeddedStylesheets: [], stylesheetHrefs: [] });
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rito-rust-fixture-'));
  temporaryRoots.push(root);
  return root;
}

async function loadFixtureIo(): Promise<FixtureIoModule> {
  const value: unknown = await importScript('rust-fixture-io.mjs');
  if (!isRecord(value) || typeof value['writeCanonicalFixture'] !== 'function') {
    throw new Error('rust-fixture-io.mjs is missing writeCanonicalFixture');
  }
  return value as unknown as FixtureIoModule;
}

async function loadXhtmlNormalization(): Promise<XhtmlNormalizationModule> {
  const value: unknown = await importScript('rust-fixture-xhtml-normalization.mjs');
  if (!isRecord(value) || typeof value['normalizeParseResult'] !== 'function') {
    throw new Error('normalization module is missing normalizeParseResult');
  }
  return value as unknown as XhtmlNormalizationModule;
}

function importScript(name: string): Promise<unknown> {
  return import(pathToFileURL(join(PACKAGE_ROOT, 'scripts', name)).href) as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
