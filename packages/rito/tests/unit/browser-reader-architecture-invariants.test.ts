import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const READER_ROOT = join(SRC, 'reader');
const BROWSER_READER_BINDING = join(SRC, 'bindings/browser/reader');
const BROWSER_CORE_CONTRACTS = join(SRC, 'bindings/browser/core-contracts.ts');
const BROWSER_READER_WASM_MODULE = join(BROWSER_READER_BINDING, 'wasm-module.ts');
const BROWSER_CANVAS_TEXT = join(SRC, 'bindings/browser/canvas-text');
const BROWSER_PRIMITIVE_RENDERER = join(SRC, 'bindings/browser/primitive-renderer.ts');
const BROWSER_PRIMITIVE_BLITS = join(SRC, 'bindings/browser/primitive-blits.ts');
const BROWSER_RENDERING = join(SRC, 'bindings/browser/rendering.ts');
const BROWSER_COMMIT_FRAME = join(SRC, 'bindings/browser/commit-frame.ts');
const BROWSER_READER_METHODS = join(BROWSER_READER_BINDING, 'reader-methods.ts');
const BROWSER_READER_FACADE = join(BROWSER_READER_BINDING, 'reader.ts');
const BROWSER_READER_TYPES = join(BROWSER_READER_BINDING, 'types.ts');
const BROWSER_READER_WORKER_CLIENT = join(BROWSER_READER_BINDING, 'worker-client.ts');
const BROWSER_READER_WORKER_ENTRY = join(BROWSER_READER_BINDING, 'worker-entry.mjs');
const BROWSER_READER_REFLOW = join(BROWSER_READER_BINDING, 'pipeline/revision-reflow.ts');
const BROWSER_READER_REVISION = join(BROWSER_READER_BINDING, 'revision.ts');
const BROWSER_REVISION_COMMIT = join(SRC, 'bindings/browser/revision-commit.ts');
const BROWSER_READER_INTERACTION = join(BROWSER_READER_BINDING, 'interaction.ts');
const BROWSER_READER_INTERACTION_CAPTURE = join(BROWSER_READER_BINDING, 'interaction-capture.ts');
const BROWSER_READER_SOURCE_RANGE = join(BROWSER_READER_BINDING, 'source-range.ts');
const BROWSER_READER_TEXT_SELECTION = join(BROWSER_READER_BINDING, 'text-selection.ts');
const BROWSER_READER_TEXT_SELECTION_FROM_POINTS = join(
  BROWSER_READER_BINDING,
  'text-selection-from-points.ts',
);
const BROWSER_READER_TEXT_SELECTION_SUPPORT = join(
  BROWSER_READER_BINDING,
  'text-selection-support.ts',
);
const BROWSER_READER_WORKER_BOOTSTRAP = join(BROWSER_READER_BINDING, 'worker-bootstrap.ts');
const BROWSER_READER_WORKER_MAIN = join(BROWSER_READER_BINDING, 'worker-main.ts');
const BROWSER_RESOURCE_ADAPTER = join(SRC, 'bindings/browser/resources.ts');
const BROWSER_PUBLICATION_FONTS = join(SRC, 'bindings/browser/publication-fonts.ts');
const BROWSER_READER_SESSION_HOST = join(SRC, 'bindings/browser/reader-session-host.ts');
const BROWSER_READER_RESOURCE_SCHEDULER = join(BROWSER_READER_BINDING, 'resources/scheduler.ts');
const BROWSER_READER_BINDING_FILES = walkTs(BROWSER_READER_BINDING);
const READER_ROOT_FILES = walkTs(READER_ROOT);
// Worker-scoped revision ownership, stale-result guards, exact selection, durable
// source reads, granular point ranges, fixed-anchor selection movement, double-page anchors,
// atomic reflow, locator navigation, and
// exact-version frame/resource/search ownership, failure-isolated disposal, and
// host-task disposal barriers are required orchestration capabilities.
// Raised for the conformance diagnostics surface: the pixel oracle reads
// committed frames through one debug module.
const BROWSER_READER_THIN_SHELL_FILE_BUDGET = 25;
// Raised for the exact-read reclaim path: a suspended session that never
// reopens its gate must be retired, not waited on forever.
// Raised again for the fragment page-table lever: open threading, the
// backend-change frame-cache guard, and background completion.
// Raised for the theme-invalidation signal: `setTheme` changed state and
// told nobody, so a dark-mode switch never reached the screen. The binding
// cannot repaint for the host (it knows neither the target nor the scale),
// so it reports the invalidation the host already listens for.
// +12 lines (2026-07-27): element-sourced natural image decode — the only
// drawImage source that reproduces the browser raster bit for bit.
// +4 lines (2026-09-07): every worker open hands the engine the canvas
// device pixel ratio, so raster snaps land on the device grid.
// Lowered (2026-10-01): the engine derives line metrics itself, so the
// browser no longer measures, injects or reflows for them.
const BROWSER_READER_THIN_SHELL_LINE_BUDGET = 3311;
// Exact native interaction, point-granularity and keyboard-movement DTOs stay public
// without exposing revision-local addresses.
// Includes the experimental fragment-pagination option.
const READER_PUBLIC_CONTRACT_LINE_BUDGET = 719;

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

function rel(path: string): string {
  return relative(SRC, path).split(sep).join('/');
}

function lineCount(files: readonly string[]): number {
  return files.reduce((sum, file) => sum + read(file).split('\n').length, 0);
}

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

describe('Browser reader architecture invariant: browser reader binding stays product-facing', () => {
  it('stays within the counted thin-shell budget', () => {
    expect(BROWSER_READER_BINDING_FILES.length).toBeLessThanOrEqual(
      BROWSER_READER_THIN_SHELL_FILE_BUDGET,
    );
    expect(lineCount(BROWSER_READER_BINDING_FILES)).toBeLessThanOrEqual(
      BROWSER_READER_THIN_SHELL_LINE_BUDGET,
    );
    expect(READER_ROOT_FILES.length).toBeLessThanOrEqual(6);
    expect(lineCount(READER_ROOT_FILES)).toBeLessThanOrEqual(READER_PUBLIC_CONTRACT_LINE_BUDGET);
  });

  it('keeps runtime pipeline and state machine files out of the binding root', () => {
    const rootFiles = readdirSync(BROWSER_READER_BINDING)
      .filter((entry) => entry.endsWith('.ts'))
      .sort();
    const misplaced = rootFiles.filter((entry) =>
      /^(?:reflow|revision-|visual-preview|state|state-groups|resource-scheduler)\.ts$/.test(entry),
    );
    expect(
      misplaced,
      `Browser reader root should stay facade/platform oriented; move pipeline/state files into subdirectories:\n${JSON.stringify(
        misplaced,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('keeps worker protocol aliases behind the core binding boundary', () => {
    expect(
      existsSync(join(BROWSER_READER_BINDING, 'worker-protocol.ts')),
      'Browser reader should consume private core-wasm worker contracts through core-contracts.ts.',
    ).toBe(false);
    expect(
      existsSync(join(BROWSER_READER_BINDING, 'worker-client-methods.ts')),
      'Worker request wrappers should not live in a separate Browser-owned protocol layer.',
    ).toBe(false);
    expect(read(BROWSER_CORE_CONTRACTS)).toContain('BrowserReaderWorkerRequest');
    expect(read(BROWSER_READER_WORKER_CLIENT)).toContain('createInProcessBrowserReaderSession');
  });

  it('does not keep implementation-language filenames in reader/', () => {
    const files = walkTs(READER_ROOT).map(rel).sort();
    const hits = files.filter((file) => /(^|\/)rust-|rust-reader|rust-worker/.test(file));
    expect(
      hits,
      `Implementation-language reader filenames found:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not use implementation-prefixed symbols in TypeScript reader glue', () => {
    const hits = scan(
      BROWSER_READER_BINDING_FILES,
      /\b(?:Rust[A-Za-z0-9_]*|RUST_[A-Z0-9_]*|rust-|CoreWasm[A-Za-z0-9_]*|Wasm[A-Za-z0-9_]*)/g,
    );
    expect(
      hits,
      `Implementation-language reader symbols found:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not revive migration-era engine naming in browser reader glue', () => {
    const hits = scan(
      BROWSER_READER_BINDING_FILES,
      /\bReaderEngine\b|reader-engine|reader engine|Reader engine/g,
    );
    expect(
      hits,
      `Migration-era engine naming found in browser reader glue:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('keeps browser reader bindings free of engine-level modules', () => {
    const hits = scan(
      BROWSER_READER_BINDING_FILES,
      /(?:from\s+|import\s*\()\s*['"](?:\.\.\/){3,}(?:layout|render|runtime|parser|style|interaction|dom|utils|model)(?:\/|['"])/g,
    );
    expect(
      hits,
      `Browser reader binding imported engine-level TypeScript modules:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('keeps the Canvas renderer adapter a primitive blitter', () => {
    const source = read(BROWSER_RENDERING);
    expect(source).not.toContain('drawTextFragment');
    expect(source).not.toContain('drawRubyFragment');
    expect(source).toContain("from './image-href-resolver'");
    expect(source).toContain('renderReaderPrimitivesToCanvas');
    expect(source).not.toContain('canvasDisplayListRenderer');
    expect(source).not.toContain('as unknown as');
  });

  it('keeps production Canvas command helpers wired through the primitive renderer', () => {
    expect(read(BROWSER_PRIMITIVE_RENDERER)).toContain("from './primitive-blits'");
    expect(read(BROWSER_PRIMITIVE_RENDERER)).toContain("from './canvas-text/renderer'");
  });

  it('keeps the browser pen a blitter: no block geometry law lives in the binding', () => {
    // Every raster decision for blocks (border bands, dot cadences, radius
    // outlines, shadow spread, background tiling) is the engine's; the
    // binding only traces device paths. A block-painting module returning
    // here means a law was re-implemented on the host.
    const browserRoot = join(SRC, 'bindings/browser');
    const entries = readdirSync(browserRoot);
    expect(entries.filter((entry) => /^canvas-block$|^canvas-path\.ts$/.test(entry))).toEqual([]);
    expect(existsSync(join(browserRoot, 'frame-command-renderer.ts'))).toBe(false);
    const hits = scan(
      [BROWSER_PRIMITIVE_RENDERER, BROWSER_PRIMITIVE_BLITS],
      /Math\.(?:round|floor|ceil)\(/g,
    );
    expect(
      hits,
      `The primitive blitter must not snap; the engine resolved every coordinate:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('keeps production Canvas paint helpers on paint-ready values', () => {
    const paintHelpers = [BROWSER_PRIMITIVE_BLITS, ...walkTs(BROWSER_CANVAS_TEXT)];
    const hits = scan(
      paintHelpers,
      /\.split\(|\bnew\s+RegExp\s*\(|^\s*const\s+[A-Z_]+_RE\s*=\s*\//gm,
    );
    expect(
      hits,
      `Production Canvas paint helper parsed CSS strings:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('keeps the main thread on the WASM-free runtime and the full module in the worker', () => {
    const coreContractsSource = read(BROWSER_CORE_CONTRACTS);
    const wasmModuleSource = read(BROWSER_READER_WASM_MODULE);
    const workerBootstrapSource = read(BROWSER_READER_WORKER_BOOTSTRAP);
    const rootContractStatements = coreContractsSource
      .split(';')
      .filter((statement) => statement.includes("from '@ritojs/core-wasm'"));

    expect(coreContractsSource).toContain("from '@ritojs/core-wasm/decoder'");
    expect(rootContractStatements.length).toBeGreaterThan(0);
    expect(
      rootContractStatements.every((statement) => statement.trimStart().startsWith('export type')),
    ).toBe(true);
    expect(wasmModuleSource).toContain("import('@ritojs/core-wasm')");
    expect(wasmModuleSource).not.toContain("import('@ritojs/core-wasm/decoder')");
    expect(workerBootstrapSource).toContain("from '@ritojs/core-wasm'");
    expect(workerBootstrapSource).not.toContain("from '../core-contracts'");

    const allowed = new Set([
      BROWSER_CORE_CONTRACTS,
      BROWSER_READER_WASM_MODULE,
      BROWSER_READER_WORKER_BOOTSTRAP,
    ]);
    const hits = scan(
      [...BROWSER_READER_BINDING_FILES, BROWSER_CORE_CONTRACTS],
      /(?:from\s+|import\s*\()\s*['"]@ritojs\/core-wasm(?:\/decoder)?['"]/g,
      (file) => allowed.has(file),
    );
    expect(
      hits,
      `Browser reader binding should import the private wasm package only through core-contracts/wasm-module/worker-main:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('only the frame decoder and renderer consume decoded frame commands', () => {
    const allowed = new Set([join(BROWSER_READER_BINDING, 'frame.ts'), BROWSER_RENDERING]);
    const hits = scan(
      BROWSER_READER_BINDING_FILES,
      /\bframe\.commands\b|commands:\s*decoded\.commands/g,
      (file) => allowed.has(file),
    );
    expect(
      hits,
      `Browser reader policy code should use Rust metadata, not decoded commands:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('keeps reflow scheduler state behind a nested runtime state object', () => {
    const source = read(BROWSER_READER_TYPES);
    const stateBody = source.match(/export interface BrowserReaderState \{([\s\S]*?)\n\}/)?.[1];
    expect(stateBody).toBeDefined();
    expect(stateBody).toContain('reflow: BrowserReaderReflowState');
    for (const field of [
      'reflowActive',
      'fullReflowActive',
      'reflowToken',
      'queuedReflow',
      'deferredFullReflow',
      'lastReflowError',
    ]) {
      expect(stateBody).not.toContain(field);
    }
  });

  it('keeps committed revision state anchored on one Rust revision bundle', () => {
    const source = read(BROWSER_READER_TYPES);
    const stateBody = source.match(/export interface BrowserReaderState \{([\s\S]*?)\n\}/)?.[1];
    expect(stateBody).toBeDefined();
    expect(stateBody).toContain('revisionBundle: CoreRevisionBundle');
    expect(stateBody).not.toContain('revision: CoreRevisionSummary');
    expect(stateBody).not.toContain('navigation: CoreRevisionNavigation');
  });

  it('centralizes revision session ownership and exact-read gating in the Browser host', () => {
    const contracts = read(BROWSER_CORE_CONTRACTS);
    const state = read(BROWSER_READER_TYPES);
    const host = read(BROWSER_READER_SESSION_HOST);
    const handles = read(join(BROWSER_READER_BINDING, 'pipeline/revision-handle.ts'));

    expect(contracts).toContain('createRitoCoreWasmReaderRevisionSession');
    expect(state).toContain('revisionSessions: BrowserReaderRevisionSessionSlots');
    expect(host).toContain('slots.current');
    expect(host).toContain('slots.candidate');
    expect(host).toContain('suspendBrowserReaderExactReads');
    expect(host).toContain('Promise.allSettled');
    expect(handles).toContain('revisionOwnerAllowsRead');
  });

  it('keeps reader-methods as the Reader API facade', () => {
    const source = read(BROWSER_READER_METHODS);
    expect(source).not.toContain("from './methods/");
    expect(source).toContain('buildBrowserReaderMethods');
    expect(source).toContain('scheduleBrowserReaderReflow');
  });

  it('keeps production reflow on Rust revision session candidates', () => {
    const source = read(BROWSER_READER_REFLOW);
    expect(source).toContain('startBrowserReaderRevisionCandidate');
    expect(source).toContain('createBrowserReaderRevisionSessionOwner');
    expect(source).not.toContain('createViewRevision');
    expect(source).not.toContain('visualPreview');
    expect(source).not.toContain('deferred');
    expect(source).not.toContain('fullReflowWorker');
  });

  it('does not retain the preview, deferred, or host-owned revision lifecycle', () => {
    const sources = [
      read(BROWSER_READER_TYPES),
      read(BROWSER_READER_REVISION),
      read(BROWSER_RENDERING),
      read(BROWSER_RESOURCE_ADAPTER),
      read(BROWSER_COMMIT_FRAME),
    ];
    for (const source of sources) {
      expect(source).not.toContain('visualPreview');
      expect(source).not.toContain('fullReflowWorker');
      expect(source).not.toContain('commitBrowserReaderViewResult');
    }
    expect(read(BROWSER_READER_TYPES)).not.toContain('deferredTimer');
    expect(read(BROWSER_READER_REVISION)).not.toContain('releaseRevisionAtRevision');
  });

  it('keeps semantic interaction reads exact-versioned and gated', () => {
    const source = read(BROWSER_READER_INTERACTION);
    const captureSource = read(BROWSER_READER_INTERACTION_CAPTURE);
    const sourceRangeSource = read(BROWSER_READER_SOURCE_RANGE);
    const textSelectionSource = read(BROWSER_READER_TEXT_SELECTION);
    const pointRangeSource = read(BROWSER_READER_TEXT_SELECTION_FROM_POINTS);
    const textSelectionSupport = read(BROWSER_READER_TEXT_SELECTION_SUPPORT);
    expect(source).toContain('getPageTargetsAtRevision');
    expect(source).toContain('getFootnoteAtRevision');
    expect(source).toContain('resolveSourceLocatorAtRevision');
    expect(captureSource).toContain('isCurrentRevisionHandle');
    expect(captureSource).not.toContain('visualPreview');
    expect(sourceRangeSource).toContain('resolveExactSourceRangeAtRevision');
    expect(sourceRangeSource).toContain('readCapturedInteraction');
    expect(textSelectionSource).toContain('resolveTextCaretAtRevision');
    expect(textSelectionSource).toContain('resolveTextRangeAtRevision');
    expect(pointRangeSource).toContain('resolveTextRangeFromPointsAtRevision');
    expect(textSelectionSupport).toContain('WeakMap<ReaderTextCaret, BoundCaret>');
  });

  it('commits only Rust-selected revision bundle frames without browser-side warm fallback', () => {
    const reflowSource = read(BROWSER_READER_REFLOW);
    const revisionCommitSource = read(BROWSER_REVISION_COMMIT);
    const commitFrameSource = read(BROWSER_COMMIT_FRAME);
    expect(reflowSource).not.toContain('warmFrameWindow');
    expect(reflowSource).toContain('startBrowserReaderRevisionCandidate');
    expect(reflowSource).not.toContain('decodeBrowserReaderFrame');
    expect(revisionCommitSource).not.toContain('warmFrameWindow');
    expect(revisionCommitSource).toContain('prepareControllerOwnedBrowserReaderCommitFrame');
    expect(commitFrameSource).toContain('decodeBrowserReaderFrame');
    expect(commitFrameSource).toContain('result.selectedFrame');
  });

  it('does not keep a TypeScript resource scheduler layer for frame windows', () => {
    expect(
      existsSync(BROWSER_READER_RESOURCE_SCHEDULER),
      'Frame/resource warm policy should stay behind the Rust warm-window API; browser code should only apply returned frames and resources.',
    ).toBe(false);
  });

  it('does not duplicate initial frame buffers outside the Rust planned frame window', () => {
    expect(read(BROWSER_CORE_CONTRACTS)).not.toContain('readonly initialFrame');
    expect(read(BROWSER_READER_WORKER_MAIN)).not.toContain('initialFrame.bytes');
    expect(existsSync(join(BROWSER_READER_BINDING, 'worker-main/frame.ts'))).toBe(false);
  });

  it('does not expose unused worker warmup commands from the browser binding', () => {
    const workerClientSource = read(BROWSER_READER_WORKER_CLIENT);
    const workerBootstrapSource = read(BROWSER_READER_WORKER_BOOTSTRAP);
    expect(workerClientSource).not.toContain('warmupWorker');
    expect(workerBootstrapSource).not.toContain("case 'warmup'");
  });

  it('uses one statically analyzable worker URL in source and published builds', () => {
    const workerClientSource = read(BROWSER_READER_WORKER_CLIENT);
    const workerEntrySource = read(BROWSER_READER_WORKER_ENTRY);
    const tsdownSource = read(join(SRC, '../tsdown.config.ts'));

    expect(workerClientSource).toContain(
      "new Worker(new URL('./worker-entry.mjs', import.meta.url)",
    );
    expect(workerClientSource).not.toContain('new URL(import.meta.url).pathname');
    expect(workerClientSource).not.toContain('worker-main.mjs');
    expect(workerEntrySource).toContain(
      "import { startBrowserReaderWorker } from './worker-bootstrap.ts'",
    );
    expect(workerEntrySource).toContain('startBrowserReaderWorker()');
    expect(tsdownSource).toMatch(
      /['"]worker-entry['"]:\s*['"]src\/bindings\/browser\/reader\/worker-main\.ts['"]/,
    );
  });

  it('uses Rust revision sessions instead of browser-owned revision variants', () => {
    const workerClientSource = read(BROWSER_READER_WORKER_CLIENT);
    const reflowSource = read(BROWSER_READER_REFLOW);
    expect(workerClientSource).toContain('createRitoCoreWasmWorkerReaderClient');
    expect(reflowSource).toContain('startBrowserReaderRevisionCandidate');
    expect(reflowSource).not.toContain('createViewRevision');
    for (const legacyName of [
      'createRevision',
      'createPreviewRevision',
      'createInitialPreviewRevision',
      'createActiveChapterPreviewRevision',
    ]) {
      expect(workerClientSource).not.toContain(legacyName);
      expect(reflowSource).not.toContain(legacyName);
    }
  });

  it('scopes the shared session cache to one BrowserReader factory', () => {
    const facadeSource = read(BROWSER_READER_FACADE);
    const workerClientSource = read(BROWSER_READER_WORKER_CLIENT);
    const reflowSource = read(BROWSER_READER_REFLOW);
    const stateSource = read(BROWSER_READER_TYPES);

    expect(workerClientSource).toContain('createBrowserReaderWorkerClientFactory');
    expect(workerClientSource).toContain('let cache: BrowserReaderSessionCache | undefined = {}');
    expect(workerClientSource).toContain('const activeCache = cache');
    expect(workerClientSource).toContain(
      'createInProcessBrowserReaderSession(module, activeCache)',
    );
    expect(workerClientSource).toContain('createRitoCoreWasmWorkerReaderClient(worker, cache');
    expect(workerClientSource).toContain('createBrowserReaderWorkerShellPool');
    expect(workerClientSource).toContain('factory.dispose = () =>');
    expect(workerClientSource).toContain('cache = undefined');
    expect(facadeSource).toContain('const workerFactory = createBrowserReaderWorkerClientFactory');
    expect(facadeSource).toContain('const worker = workerFactory()');
    expect(stateSource).toContain('readonly workerFactory: BrowserReaderWorkerClientFactory');
    expect(reflowSource).toContain('const worker = state.workerFactory()');
    expect(reflowSource).not.toContain('createBrowserReaderWorkerClient');
  });

  it('delegates worker payload construction to the private core-wasm wrapper', () => {
    const workerBootstrapSource = read(BROWSER_READER_WORKER_BOOTSTRAP);
    expect(workerBootstrapSource).toContain('createRitoCoreWasmReaderWorkerHandler');
    expect(workerBootstrapSource).not.toContain('readerWorkerPayload');
    for (const file of [
      'worker-main/frame.ts',
      'worker-main/revision.ts',
      'worker-main/resource.ts',
      'worker-main/document-session.ts',
      'worker-main/message.ts',
    ]) {
      expect(existsSync(join(BROWSER_READER_BINDING, file))).toBe(false);
    }
  });

  it('keeps revision-owned Browser reads and releases on exact-version worker methods', () => {
    const files = [
      ...BROWSER_READER_BINDING_FILES,
      BROWSER_RESOURCE_ADAPTER,
      join(SRC, 'bindings/browser/required-fonts.ts'),
      BROWSER_COMMIT_FRAME,
    ];
    const hits = scan(
      files,
      /\.(?:readResource|warmFrameWindow|search|releaseRevision|releaseRevisionTransfers)\s*\(/g,
    );

    expect(
      hits,
      `Browser reader used a revisionId-only worker operation:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('uses Rust revision font summaries instead of probing frames for fallback fonts', () => {
    const source = read(BROWSER_RESOURCE_ADAPTER) + read(BROWSER_PUBLICATION_FONTS);
    expect(source).toContain('state.revisionBundle.fontFamilies');
    expect(source).not.toContain('./frame-cache');
    expect(source).not.toContain('ensureFrameLoaded');
    expect(source).not.toContain('firstFrameFontFamily');
  });
});
