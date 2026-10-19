import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const WORKSPACE_ROOT = join(SRC, '../../..');
const READER_ROOT = join(SRC, 'reader');
const BROWSER_BINDING = join(SRC, 'bindings/browser');
const SESSION_READER = join(BROWSER_BINDING, 'session-reader');
const BROWSER_CORE_CONTRACTS = join(BROWSER_BINDING, 'core-contracts.ts');
const BROWSER_CANVAS_TEXT = join(BROWSER_BINDING, 'canvas-text');
const BROWSER_PRIMITIVE_RENDERER = join(BROWSER_BINDING, 'primitive-renderer.ts');
const BROWSER_PRIMITIVE_BLITS = join(BROWSER_BINDING, 'primitive-blits.ts');
const BROWSER_SESSION = join(BROWSER_BINDING, 'reader-session.ts');
const BROWSER_SESSION_ENGINE = join(BROWSER_BINDING, 'reader-session-in-thread.ts');
const BROWSER_SESSION_CANVAS = join(BROWSER_BINDING, 'reader-session-canvas.ts');
const BROWSER_BINDING_FILES = walkTs(BROWSER_BINDING);
const SESSION_READER_FILES = walkTs(SESSION_READER);
const READER_ROOT_FILES = walkTs(READER_ROOT);
// The reader built on the session protocol: opening, the two-phase layout
// commit, spreads held within the session's live-artifact budget, turns,
// the whole-book run, interactions asked of one live artifact, resources
// and host fonts. Lowered from 25 files and 3332 lines (2026-10-10) when it
// replaced the reader built on revisions.
// +50 lines (2026-10-10): the queue every operation on artifacts runs
// through (queue.ts) and the one module that owns artifacts (artifacts.ts).
// They took the place of three concurrent chains, whose interleavings left
// a reader that ignored every later setting.
// +25 lines (2026-10-17): the host's hold on the whole-book run, which kit
// takes while a window is resized so each size is laid out at once (the
// run occupies the session for as long as the book takes), and the
// listener registrations moved beside the state they register into, which
// kept reader.ts within the file limit.
// +2 lines (2026-10-17): the hold also keeps the spreads beside the one
// shown from loading, each for a layout the next size replaces.
// +39 lines (2026-10-17): while the hold stands a relayout reads only the
// page table laid out so far, since the engine lays a chapter out only
// through the spread shown and the whole table would have it lay out the
// rest for every size; releasing the hold reads the whole table.
// +35 lines (2026-10-18): the engine runs on the page's own thread, so a
// frame draws the size it asked for; the whole book then lays out a few
// pages per step, each step after the page has had a turn, and a step
// that lays pages out counts as progress however many the book takes.
// +58 lines (2026-10-18): a source range resolved as a selection, carets
// included, so a selection made in one layout is shown again in the next.
// +16 lines (2026-10-18): `setDevicePixelRatio`, the book laid out at the
// screen's new pixel ratio and taken as it commits.
// +19 lines (2026-10-18): the geometry a reader publishes is where the
// engine laid its pages out, a spread's pages on the device grid.
// +4 lines (2026-10-19): a page's targets, outline and text are asked of
// the session when the reader needs them, not read off every artifact.
// +8 lines (2026-10-19): the whole book waits out the frame the first
// page is drawn in.
const SESSION_READER_FILE_BUDGET = 22;
const SESSION_READER_LINE_BUDGET = 2855;
// Exact native interaction, point-granularity and keyboard-movement DTOs stay public
// without exposing revision-local addresses.
// +52 lines (2026-10-03): the font catalog types a font picker is built
// from, and the reader's four font methods.
// +9 lines (2026-10-09): `layoutScope` tells a chapter-first commit from
// the whole book's.
// +5 lines (2026-10-17): `holdBookLayout`, a host's hold on the whole-book
// layout.
// +8 lines (2026-10-18): `resolveTextRangeFromSource`, a source range
// resolved as a selection with its carets.
// +5 lines (2026-10-18): `ReaderGlTarget`, a WebGL2 framebuffer
// `renderSpreadTo` paints into.
// +6 lines (2026-10-18): `setDevicePixelRatio`, a layout at the screen's
// new pixel ratio.
const READER_PUBLIC_CONTRACT_LINE_BUDGET = 806;

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

function walkRust(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walkRust(full));
    else if (full.endsWith('.rs')) out.push(full);
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

describe('Browser reader architecture invariant: the reader stays a thin shell', () => {
  it('stays within the counted thin-shell budget', () => {
    expect(SESSION_READER_FILES.length).toBeLessThanOrEqual(SESSION_READER_FILE_BUDGET);
    expect(lineCount(SESSION_READER_FILES)).toBeLessThanOrEqual(SESSION_READER_LINE_BUDGET);
    expect(READER_ROOT_FILES.length).toBeLessThanOrEqual(6);
    expect(lineCount(READER_ROOT_FILES)).toBeLessThanOrEqual(READER_PUBLIC_CONTRACT_LINE_BUDGET);
  });

  it('does not keep implementation-language filenames in reader/', () => {
    const files = [...walkTs(READER_ROOT), ...BROWSER_BINDING_FILES].map(rel).sort();
    const hits = files.filter((file) => /(^|\/)rust-|rust-reader|rust-worker/.test(file));
    expect(
      hits,
      `Implementation-language reader filenames found:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not use implementation-prefixed symbols in TypeScript reader glue', () => {
    const hits = scan(
      SESSION_READER_FILES,
      /\b(?:Rust[A-Za-z0-9_]*|RUST_[A-Z0-9_]*|rust-|CoreWasm[A-Za-z0-9_]*|Wasm[A-Za-z0-9_]*)/g,
    );
    expect(
      hits,
      `Implementation-language reader symbols found:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('does not revive migration-era engine naming in browser reader glue', () => {
    const hits = scan(
      BROWSER_BINDING_FILES,
      /\bReaderEngine\b|reader-engine|reader engine|Reader engine/g,
    );
    expect(
      hits,
      `Migration-era engine naming found in browser reader glue:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('keeps browser reader bindings free of engine-level modules', () => {
    const hits = scan(
      BROWSER_BINDING_FILES,
      /(?:from\s+|import\s*\()\s*['"](?:\.\.\/){2,}(?:layout|render|runtime|parser|style|interaction|dom|utils|model)(?:\/|['"])/g,
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
});

describe('Browser reader architecture invariant: one host protocol', () => {
  it('speaks the reader session protocol and nothing of the revision runtime', () => {
    // A reader lays out, turns and answers through one session. The
    // revision runtime it replaced had its own worker, its own handles and
    // a chapter-local preview beside it; none of that may come back.
    const hits = scan(
      BROWSER_BINDING_FILES,
      /createRevision|AtRevision\b|RevisionSession|revisionBundle|[cC]hapterLocal|createViewRevision|visualPreview/g,
    );
    expect(hits, `Revision runtime vocabulary found:\n${JSON.stringify(hits, null, 2)}`).toEqual(
      [],
    );
    for (const retired of ['reader', 'chapter-local-preview']) {
      expect(existsSync(join(BROWSER_BINDING, retired)), retired).toBe(false);
    }
  });

  it('runs the engine on the page thread: no worker, one build entry', () => {
    // A size the page asks for is laid out within the frame that asked,
    // which an engine apart from the page cannot answer in time.
    expect(scan(BROWSER_BINDING_FILES, /new Worker\(/g)).toEqual([]);
    expect(read(BROWSER_SESSION)).toContain('createInThreadReaderSessionWorker()');
    const tsdownSource = read(join(SRC, '../tsdown.config.ts'));
    const entries = [...tsdownSource.matchAll(/['"]?([\w-]+)['"]?:\s*['"]src\/[^'"]+['"]/g)].map(
      (match) => match[1],
    );
    expect(entries).toEqual(['index']);
  });

  it('keeps the wasm package behind the decoder entry and the one module that hosts the engine', () => {
    const coreContractsSource = read(BROWSER_CORE_CONTRACTS);
    const rootContractStatements = coreContractsSource
      .split(';')
      .filter((statement) => statement.includes("from '@ritojs/core-wasm'"));
    expect(rootContractStatements.length).toBeGreaterThan(0);
    expect(
      rootContractStatements.every((statement) => statement.trimStart().startsWith('export type')),
    ).toBe(true);
    expect(read(BROWSER_SESSION_ENGINE)).toMatch(/^} from '@ritojs\/core-wasm';$/m);

    const allowed = new Set([BROWSER_CORE_CONTRACTS, BROWSER_SESSION_ENGINE]);
    const hits = scan(
      BROWSER_BINDING_FILES,
      /(?:from\s+|import\s*\()\s*['"]@ritojs\/core-wasm['"]/g,
      (file) => allowed.has(file),
    );
    expect(
      hits,
      `The page side reaches the wasm package only through its decoder entry:\n${JSON.stringify(
        hits,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it('delegates the protocol handler to the private core-wasm wrapper', () => {
    const engineSource = read(BROWSER_SESSION_ENGINE);
    expect(engineSource).toContain('createRitoCoreWasmReaderSessionWorkerHandler');
    expect(lineCount([BROWSER_SESSION_ENGINE])).toBeLessThanOrEqual(70);
  });
});

describe('Browser reader architecture invariant: the engine lays out, the shell paints', () => {
  it('paints an artifact through the primitive renderer and nothing else', () => {
    const source = read(BROWSER_SESSION_CANVAS);
    expect(source).toContain('renderReaderPrimitivesToCanvas');
    expect(source).not.toContain('drawTextFragment');
    expect(source).not.toContain('drawRubyFragment');
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
    const entries = readdirSync(BROWSER_BINDING);
    expect(entries.filter((entry) => /^canvas-block$|^canvas-path\.ts$/.test(entry))).toEqual([]);
    expect(existsSync(join(BROWSER_BINDING, 'frame-command-renderer.ts'))).toBe(false);
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

  it('never reads a display list outside the presenter', () => {
    // What a reader decides — which spread, which page, what a tap means —
    // it decides from an artifact's metadata. The display list is paint.
    const hits = scan(SESSION_READER_FILES, /displayList/g);
    expect(
      hits,
      `Reader policy code read a display list:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('converts between page and display-list coordinates in one place', () => {
    // The session speaks the display-list space of a spread; a reader
    // speaks page-content coordinates. The difference is the page's content
    // origin, taken from the geometry the reader publishes — in one module.
    const allowed = new Set([
      join(SESSION_READER, 'page-space.ts'),
      join(SESSION_READER, 'layout-options.ts'),
    ]);
    const hits = scan(
      SESSION_READER_FILES,
      /\b(?:marginLeft|marginTop|marginRight|marginBottom|pageWidth|pageHeight|spreadGap)\b/g,
      (file) => allowed.has(file),
    );
    expect(
      hits,
      `Page geometry used outside page-space:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });
});

describe('Browser reader architecture invariant: one committed layout', () => {
  it('replaces the committed layout only by committing one', () => {
    const allowed = new Set([join(SESSION_READER, 'commit.ts')]);
    const hits = scan(
      SESSION_READER_FILES,
      /state\.(?:view|config|layoutGeneration)\s*(?:\+=|=(?!=))/g,
      (file) => allowed.has(file),
    );
    expect(
      hits,
      `The committed layout was replaced outside its commit:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it("owns the session's artifacts in one module", () => {
    // Asking for an artifact, having the session show one and giving one
    // back are all in artifacts.ts, where whatever is not shown or installed
    // is released before a function returns or throws. No other module
    // can hold an artifact the session does not know the fate of.
    const hits = scan(
      SESSION_READER_FILES,
      /\.(?:requestArtifact|requestAdjacent|seek|adoptForegroundCandidate|commitPeekedArtifact|adoptBackgroundCandidate|advanceBackgroundOnce|peekSpread|peekAdjacent|release)\(/g,
      (file) => file === join(SESSION_READER, 'artifacts.ts'),
    );
    expect(
      hits,
      `An artifact was asked for, shown or released outside artifacts.ts:\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it('works on artifacts through one queue, one operation at a time', () => {
    // A request and the adoption of its result, a spread loaded ahead and a
    // step of the whole book never overlap: the live-artifact budget is
    // counted exactly and nothing reaches the session between a request and
    // its adoption. So the functions that own artifacts are called only by
    // the modules whose work is an operation of the queue (and by opening,
    // before there is a queue), and the queue is the only scheduler: no
    // second chain, no timer, no retry.
    const operations = new Set(
      ['artifacts', 'frames', 'commit', 'foreground', 'background', 'reader'].map((name) =>
        join(SESSION_READER, `${name}.ts`),
      ),
    );
    const owners = scan(
      SESSION_READER_FILES,
      /\b(?:adoptSessionReaderFirstFrame|requestSessionReaderLayout|advanceSessionReaderBook|peekSessionReaderFrame|commitSessionReaderFrame|releaseSessionReaderFrame|loadSessionReaderFrame)\b/g,
      (file) => operations.has(file),
    );
    expect(owners, `Artifacts owned outside an operation:\n${JSON.stringify(owners)}`).toEqual([]);

    const queue = read(join(SESSION_READER, 'queue.ts'));
    expect(queue).toContain('if (queue.running) return;');
    expect(queue).toContain('await next();');
    const state = read(join(SESSION_READER, 'state.ts'));
    expect(state).toContain('readonly queue: SessionReaderQueue;');
    expect(state).not.toMatch(/:\s*Promise<void>;/);

    const second = scan(
      SESSION_READER_FILES,
      /setTimeout\(|setInterval\(|\bretr(?:y|ies)\b|[Rr]efusedForNow/g,
    );
    expect(second, `A second scheduler or a retry:\n${JSON.stringify(second)}`).toEqual([]);
    const microtasks = scan(SESSION_READER_FILES, /queueMicrotask\(/g);
    expect(microtasks).toEqual([
      { file: rel(join(SESSION_READER, 'queue.ts')), match: 'queueMicrotask(' },
    ]);
  });

  it('never has one operation wait for another', () => {
    // With one operation at a time, an operation that awaited a queued one
    // would wait for itself. What an operation needs from another it does
    // itself (`loadSessionReaderFrame`), and what it only starts it does
    // not await. Code outside the queue may wait for a spread to be loaded.
    const operations = ['artifacts', 'frames', 'commit', 'foreground', 'background'].map((name) =>
      join(SESSION_READER, `${name}.ts`),
    );
    const waits = scan(
      operations,
      /await\s+(?:ensureSessionReaderFrame|runSessionReaderOperation)\(/g,
    );
    expect(waits, `An operation waits on the queue:\n${JSON.stringify(waits)}`).toEqual([]);
  });

  it('asks about the committed layout through the capture that drops a superseded answer', () => {
    // An answer names pages of the layout it was asked of. Every question
    // whose answer carries pages or geometry goes through one gate that
    // resolves undefined once the layout was replaced.
    const gated =
      /\.(?:textInteraction|exactSourceRange|readFootnote|readPage|search|textRangeGeometry)\(/g;
    for (const file of SESSION_READER_FILES) {
      const source = read(file);
      if (!gated.test(source)) continue;
      gated.lastIndex = 0;
      expect(source, rel(file)).toContain('askSessionReaderLayout');
    }
    expect(read(join(SESSION_READER, 'text-selection.ts'))).toContain(
      'WeakMap<ReaderTextCaret, CaretBinding>',
    );
    expect(read(join(SESSION_READER, 'page-space.ts'))).toContain(
      'capture.generation !== state.layoutGeneration',
    );
  });

  it('answers interactions from the engine: no classification or geometry of its own', () => {
    // A target's kind, a link's destination, a caret and a range's rects
    // arrive from the session; the reader maps names and coordinates.
    const hits = scan(
      SESSION_READER_FILES,
      /\.startsWith\(['"](?:https?:|#)|epub:type|noteref|getBoundingClientRect|measureText/g,
    );
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});

describe('Workspace architecture invariant: one host protocol, everywhere', () => {
  // The reader session is the only way a host reaches the engine: through
  // WASM, through the C ABI, and through the JavaScript runtime between a
  // page and its worker. The revision runtime that stood beside it — a
  // document binding, a worker of its own, a chapter-local preview — was
  // removed layer by layer; each layer says here that it stays removed.
  it('the WASM boundary exports the reader session and no other class', () => {
    const crate = join(WORKSPACE_ROOT, 'crates/rito-wasm/src');
    const classes = walkRust(crate)
      .flatMap((file) => [
        ...read(file).matchAll(/#\[wasm_bindgen\(js_name = (\w+)\)\]\s*pub struct/g),
      ])
      .map((match) => match[1]);
    expect(classes).toEqual(['RitoReaderSession']);
    expect(readdirSync(crate).sort()).toEqual(['lib.rs', 'reader_session', 'reader_session.rs']);
  });

  it('the wasm package ships the session runtime alone', () => {
    const source = join(WORKSPACE_ROOT, 'packages/rito-core-wasm/src');
    const modules = readdirSync(source).filter((entry) => entry.endsWith('-runtime.js'));
    const foreign = modules.filter(
      (entry) => !/^(?:reader-session-|shard-prefetch-lane-|pinned-font-policy-)/.test(entry),
    );
    expect(foreign, JSON.stringify(foreign)).toEqual([]);
    const hits = scan(
      [...modules.map((entry) => join(source, entry)), ...walkTs(source)],
      /RitoWasmDocument|createRevision|AtRevision\b|RevisionSession|[cC]hapterLocal/g,
    );
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('the kit has no presentation of its own beside the reader', () => {
    const kit = join(WORKSPACE_ROOT, 'packages/kit/src');
    expect(existsSync(join(kit, 'controller/navigation/local-preview'))).toBe(false);
    const hits = scan(walkTsLike(kit), /[cC]hapterLocal|provisional|local-preview/g);
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});

describe('Workspace architecture invariant: the reader has no second way in', () => {
  it('kit and the demo reach a reader only through createReader', () => {
    const consumers = [
      join(WORKSPACE_ROOT, 'packages/kit/src'),
      join(WORKSPACE_ROOT, 'packages/react/src'),
      join(WORKSPACE_ROOT, 'apps/reader/src'),
    ]
      .filter((path) => existsSync(path))
      .flatMap(walkTsLike);
    const hits = scan(
      consumers,
      /__ritoSessionReader|openBrowserReaderSession|RitoReaderSession\b/g,
    );
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });
});
