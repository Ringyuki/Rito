import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const CORE_WASM_DIST = resolve(WORKSPACE_ROOT, 'packages/rito-core-wasm/dist');
const FONTS_DIR = resolve(WORKSPACE_ROOT, 'apps/reader/src/assets/fonts');

export const PINNED_FACES = [
  {
    fileName: 'Tinos-Regular.ttf',
    mediaType: 'font/ttf',
    expectedSha256: '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61',
    genericRole: 'serif',
    language: 'und',
  },
  {
    fileName: 'SourceHanSerifCN-Regular.otf',
    mediaType: 'font/otf',
    expectedSha256: '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d',
    genericRole: 'serif',
    language: 'zh-Hans',
  },
] as const;

/** Mirrors the demo's production layout for the pinned 420x640 fixture run. */
export const BASELINE_LAYOUT = {
  firstPageAlone: true,
  marginBottom: 24,
  marginLeft: 24,
  marginRight: 24,
  marginTop: 24,
  pageHeight: 640,
  pageWidth: 420,
  rootFontSize: 16,
  spreadGap: 0,
  spreadMode: 'single',
  viewportHeight: 640,
  viewportWidth: 420,
  textMeasurement: 'fontAware',
} as const;

export interface NativeLine {
  readonly pageIndex: number;
  /** Content-box coordinates: page coordinates minus the page margins. */
  readonly x: number;
  readonly yInPage: number;
  readonly width: number;
  readonly lineHeightPx: number;
  readonly fontSizePx: number;
  readonly text: string;
}

interface CoreWasmDocumentLike {
  createFullRevisionBundle(request: object): {
    bundle: {
      revision: { revisionId: string; knownExtent: { pageCount: number } };
      navigation: {
        chapters: readonly {
          href: string;
          startPage?: number | undefined;
          endPage?: number | undefined;
        }[];
      };
    };
  };
  getFrameCommandBufferMetadata(revisionId: string, spreadIndex: number): unknown;
  readFrameCommandBuffer(revisionId: string, spreadIndex: number): Uint8Array;
}

export interface NativeChapterLines {
  readonly chapterHref: string;
  readonly startPage: number;
  readonly endPage: number;
  readonly lines: readonly NativeLine[];
  readonly rubyCommandCount: number;
}

export async function pinnedFontBytes(): Promise<Map<string, Buffer>> {
  const entries = await Promise.all(
    PINNED_FACES.map(
      async (face) =>
        [face.expectedSha256, await readFile(resolve(FONTS_DIR, face.fileName))] as const,
    ),
  );
  return new Map(entries);
}

export async function extractNativeChapterLines(
  epubPath: string,
  chapterHrefSuffix: string,
): Promise<NativeChapterLines> {
  const coreWasm = (await import(resolve(CORE_WASM_DIST, 'index.mjs'))) as {
    initRitoCoreWasmEngine: (input: { module_or_path: Buffer }) => Promise<{
      openDocument: (bytes: Uint8Array, options?: object) => CoreWasmDocumentLike;
    }>;
    decodeRitoFrameCommandBuffer: (
      metadata: unknown,
      bytes: Uint8Array,
    ) => {
      commands: readonly Record<string, unknown>[];
    };
  };
  const { initRitoCoreWasmEngine, decodeRitoFrameCommandBuffer } = coreWasm;
  const engine = await initRitoCoreWasmEngine({
    module_or_path: await readFile(resolve(CORE_WASM_DIST, 'rito_wasm_bg.wasm')),
  });
  const fonts = await pinnedFontBytes();
  const policy = {
    schemaVersion: 1,
    faces: PINNED_FACES.map((face) => ({
      bytes: new Uint8Array(fonts.get(face.expectedSha256) ?? new Uint8Array()),
      expectedSha256: face.expectedSha256,
      genericRole: face.genericRole,
      language: face.language,
    })),
  };
  const publication = new Uint8Array(await readFile(epubPath));
  const document = engine.openDocument(publication, { pinnedFontPolicy: policy });
  const bundle = document.createFullRevisionBundle({
    layoutConfig: BASELINE_LAYOUT,
    activeSpreadIndex: 0,
  });
  const revision = bundle.bundle.revision;
  const chapter = bundle.bundle.navigation.chapters.find((entry: { href: string }) =>
    entry.href.endsWith(chapterHrefSuffix),
  );
  if (!chapter || chapter.startPage === undefined || chapter.endPage === undefined) {
    throw new Error(`Chapter ${chapterHrefSuffix} is not paginated in the baseline revision`);
  }
  const lines: NativeLine[] = [];
  let rubyCommandCount = 0;
  for (let pageIndex = chapter.startPage; pageIndex <= chapter.endPage; pageIndex += 1) {
    const metadata = document.getFrameCommandBufferMetadata(revision.revisionId, pageIndex);
    const buffer = document.readFrameCommandBuffer(revision.revisionId, pageIndex);
    const decoded = decodeRitoFrameCommandBuffer(metadata, buffer);
    const pageLines: NativeLine[] = [];
    for (const command of decoded.commands) {
      if (command['kind'] === 'paintRuby') rubyCommandCount += 1;
      if (command['kind'] !== 'paintText') continue;
      const rect = command['rect'] as { x: number; y: number; width: number; height: number };
      const paint = command['paint'] as { font: { sizePx: number } };
      pageLines.push({
        pageIndex,
        x: rect.x - BASELINE_LAYOUT.marginLeft,
        yInPage: rect.y - BASELINE_LAYOUT.marginTop,
        width: rect.width,
        lineHeightPx: command['lineHeightPx'] as number,
        fontSizePx: paint.font.sizePx,
        text: command['text'] as string,
      });
    }
    pageLines.sort((left, right) => left.yInPage - right.yInPage || left.x - right.x);
    lines.push(...mergeSameRowSegments(pageLines));
  }
  return {
    chapterHref: chapter.href,
    startPage: chapter.startPage,
    endPage: chapter.endPage,
    lines,
    rubyCommandCount,
  };
}

/** Inline spans paint as separate commands on one row; merge them into one line. */
function mergeSameRowSegments(pageLines: readonly NativeLine[]): NativeLine[] {
  const merged: NativeLine[] = [];
  for (const line of pageLines) {
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.yInPage - line.yInPage) < 0.5) {
      merged[merged.length - 1] = {
        ...previous,
        width: line.x + line.width - previous.x,
        text: previous.text + line.text,
      };
      continue;
    }
    merged.push(line);
  }
  return merged;
}

export async function readEpubEntry(epubPath: string, entrySuffix: string): Promise<string> {
  const listing = await execFileAsync('unzip', ['-Z1', epubPath]).catch((error: unknown) => ({
    stdout: (error as Error & { stdout?: string }).stdout ?? '',
  }));
  const entry = listing.stdout
    .split('\n')
    .map((name) => name.trim())
    .find((name) => name.endsWith(entrySuffix));
  if (!entry) throw new Error(`EPUB entry ${entrySuffix} not found in ${epubPath}`);
  const extracted = await execFileAsync('unzip', ['-p', epubPath, entry], {
    maxBuffer: 64 * 1024 * 1024,
  }).catch((error: unknown) => {
    const stdout = (error as Error & { stdout?: string }).stdout;
    if (!stdout) throw error;
    return { stdout };
  });
  return extracted.stdout;
}
