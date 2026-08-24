#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { writeCanonicalFixture } from './rust-fixture-io.mjs';

// CSS named colors as canonical lowercase hex, for summary canonicalization.
const NAMED_COLOR_HEX = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
};
import { normalizeParseResult, normalizeSourceRef } from './rust-fixture-xhtml-normalization.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const DIST_ROOT = resolve(PACKAGE_ROOT, 'dist');
const REFERENCE_DIST_ROOT = resolve(PACKAGE_ROOT, '.output/reference-build');
const BOOK_ROOT = resolve(PACKAGE_ROOT, 'tests/fixtures/books');
const OUTPUT_ROOT = process.env.RITO_RUST_FIXTURE_OUTPUT_ROOT
  ? resolve(process.env.RITO_RUST_FIXTURE_OUTPUT_ROOT)
  : resolve(PACKAGE_ROOT, 'tests/rust-fixtures');
const FLOAT_DIGITS = 3;
const TEXT_EDGE_LIMIT = 80;
const BLOCK_SAMPLE_LIMIT = parsePositiveInt(process.env.RITO_RUST_FIXTURE_BLOCK_SAMPLE_LIMIT, 8);

const CONFIGS = new Map([
  [
    'smoke.greedy',
    {
      id: 'smoke.greedy',
      lineBreaking: 'greedy',
      layoutInput: { width: 420, height: 640, margin: 24 },
    },
  ],
  [
    'default.greedy',
    {
      id: 'default.greedy',
      lineBreaking: 'greedy',
      layoutInput: { width: 600, height: 800, margin: 40 },
    },
  ],
  [
    'narrow.greedy',
    {
      id: 'narrow.greedy',
      lineBreaking: 'greedy',
      layoutInput: { width: 360, height: 640, margin: 28 },
    },
  ],
  [
    'default.optimal',
    {
      id: 'default.optimal',
      lineBreaking: 'optimal',
      layoutInput: { width: 600, height: 800, margin: 40 },
    },
  ],
]);

const DEFAULT_BOOK_IDS = [
  'book-01',
  'book-02',
  'book-03',
  'book-04',
  'book-05',
  'book-06',
  'book-07',
  'book-08',
  'book-09',
  'book-10',
];
const DEFAULT_CONFIG_IDS = ['smoke.greedy', 'default.greedy', 'narrow.greedy', 'default.optimal'];
const SEARCH_QUERY_SPECS = [
  { id: 'heroine-name', query: '八奈见', caseSensitive: false, wholeWord: false },
  { id: 'protagonist-name', query: '温水', caseSensitive: false, wholeWord: false },
  { id: 'reader-name', query: 'EbookReader', caseSensitive: true, wholeWord: false },
  { id: 'missing-ascii', query: 'RITO_NATIVE_NO_MATCH', caseSensitive: false, wholeWord: false },
];

try {
  installDomParser();
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

function installDomParser() {
  const window = new Window();
  if (globalThis.DOMParser === undefined) {
    globalThis.DOMParser = window.DOMParser;
  }
  if (globalThis.Node === undefined) {
    globalThis.Node = window.Node;
  }
}

async function run() {
  const check = process.env.RITO_RUST_FIXTURE_CHECK === '1';
  const bookIds = parseList(process.env.RITO_RUST_FIXTURE_BOOKS, DEFAULT_BOOK_IDS);
  const configIds = parseList(process.env.RITO_RUST_FIXTURE_CONFIGS, DEFAULT_CONFIG_IDS);
  const manifest = await readBookManifest();
  const books = bookIds.map((bookId) => requireBook(manifest, bookId));
  const configs = configIds.map(requireConfig);
  const publicCore = await import(resolve(DIST_ROOT, 'index.mjs'));
  const reference = await import(resolve(REFERENCE_DIST_ROOT, 'reference/index.mjs'));
  const advanced = await import(resolve(REFERENCE_DIST_ROOT, 'tooling/advanced.mjs'));
  const entries = [];

  for (const book of books) {
    for (const rawConfig of configs) {
      const config = { ...rawConfig, layout: publicCore.createLayoutConfig(rawConfig.layoutInput) };
      const fixture = await buildFixture({ book, config, core: reference, advanced });
      const relativePath = `${book.id}/${config.id}.json.gz`;
      await writeFixture(relativePath, fixture, check);
      entries.push({ bookId: book.id, configId: config.id, path: relativePath });
    }
  }

  await writeFixture(
    'manifest.json',
    {
      schemaVersion: 1,
      kind: 'rito-rust-parity-fixture-manifest',
      entries,
    },
    check,
  );
}

async function readBookManifest() {
  const text = await readFile(resolve(BOOK_ROOT, 'manifest.json'), 'utf8');
  const value = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('Book manifest must be an array');
  return value;
}

function requireBook(manifest, bookId) {
  const book = manifest.find((candidate) => candidate.id === bookId && candidate.enabled === true);
  if (!book) throw new Error(`Unknown or disabled book fixture: ${bookId}`);
  if (typeof book.path !== 'string') throw new Error(`Book fixture ${bookId} is missing path`);
  return book;
}

function requireConfig(configId) {
  const config = CONFIGS.get(configId);
  if (!config) throw new Error(`Unknown Rust parity fixture config: ${configId}`);
  return config;
}

async function buildFixture(input) {
  const bytes = await readFile(resolve(BOOK_ROOT, input.book.path));
  const document = input.core.loadEpub(toArrayBuffer(bytes), {
    logger: input.advanced.createLogger('silent'),
  });

  try {
    const result = input.advanced.paginateWithMeta(
      document,
      input.config.layout,
      createFixtureTextMeasurer(),
      extractImageDimensions(document.images),
      input.config.lineBreaking,
      input.advanced.createLogger('silent'),
    );
    const chapterStartPages = new Set(
      [...result.chapterMap.values()].map((range) => range.startPage),
    );
    const spreads = input.core.buildSpreads(result.pages, input.config.layout, chapterStartPages);
    const styleContext = input.core.createFixtureChapterStyleContext(
      document.stylesheets,
      input.config.layout.rootFontSize,
    );
    return {
      schemaVersion: 1,
      kind: 'rito-rust-parity-fixture',
      source: {
        package: '@ritojs/core',
        fixtureFormat: 'summary-hashes',
      },
      book: summarizeBook(input.book, bytes),
      config: summarizeConfig(input.config),
      package: summarizePackage(document),
      resources: summarizeResources(document),
      chapters: summarizeChapters(document, result),
      xhtml: summarizeXhtml(document, input.advanced),
      css: summarizeCss(document, input.advanced),
      style: summarizeStyle(
        document,
        input.advanced,
        input.config.layout,
        input.core,
        styleContext,
      ),
      layout: summarizeLayout(document, input.advanced, input.config, input.core, styleContext),
      pagination: summarizePagination(result),
      displayLists: summarizeDisplayLists(spreads, input.config.layout, input.core),
    };
  } finally {
    document.close();
  }
}

function summarizeBook(book, bytes) {
  return {
    id: book.id,
    path: book.path,
    byteLength: bytes.byteLength,
    byteHash: hashBytes(bytes),
  };
}

function summarizeConfig(config) {
  return {
    id: config.id,
    lineBreaking: config.lineBreaking,
    layout: toJsonValue(config.layout),
  };
}

function summarizePackage(document) {
  return {
    metadata: toJsonValue(document.packageDocument.metadata),
    manifest: document.packageDocument.manifest.map((item) => ({
      id: item.id,
      href: item.href,
      mediaType: item.mediaType,
      properties: item.properties ?? [],
    })),
    spine: document.packageDocument.spine.map((item) => ({
      idref: item.idref,
      linear: item.linear,
    })),
    toc: summarizeToc(document.toc),
  };
}

function summarizeResources(document) {
  return {
    stylesheets: summarizeTextResources(document.stylesheets),
    fonts: summarizeBinaryResources(document.fonts),
    images: summarizeImageResources(document.images),
  };
}

function summarizeTextResources(resources) {
  return [...resources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([href, text]) => ({
      href,
      textLength: text.length,
      textHash: hashText(text),
    }));
}

function summarizeBinaryResources(resources) {
  return [...resources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([href, bytes]) => ({
      href,
      byteLength: bytes.byteLength,
      byteHash: hashBytes(bytes),
    }));
}

function summarizeImageResources(resources) {
  return [...resources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([href, bytes]) => ({
      href,
      byteLength: bytes.byteLength,
      byteHash: hashBytes(bytes),
      ...parseImageDimensions(bytes),
    }));
}

function extractImageDimensions(resources) {
  const dimensions = new Map();
  for (const [href, bytes] of resources) {
    const size = parseImageDimensions(bytes);
    if (size.width !== undefined && size.height !== undefined) {
      dimensions.set(href, size);
    }
  }
  return dimensions;
}

function parseImageDimensions(bytes) {
  return parsePngDimensions(bytes) ?? parseJpegDimensions(bytes) ?? {};
}

function parsePngDimensions(bytes) {
  if (bytes.byteLength < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  if (readAscii(bytes, 12, 4) !== 'IHDR') return null;
  return {
    width: readU32be(bytes, 16),
    height: readU32be(bytes, 20),
  };
}

function parseJpegDimensions(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.byteLength) return null;

    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 1 >= bytes.byteLength) return null;
    const segmentLength = readU16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (isJpegSofMarker(marker) && segmentLength >= 7) {
      return {
        height: readU16be(bytes, offset + 3),
        width: readU16be(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegSofMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readAscii(bytes, offset, length) {
  const start = Number(offset);
  const end = start + Number(length);
  return String.fromCharCode(...bytes.slice(start, end));
}

function readU16be(bytes, offset) {
  return viewFor(bytes, offset, 2).getUint16(0, false);
}

function readU32be(bytes, offset) {
  return viewFor(bytes, offset, 4).getUint32(0, false);
}

function viewFor(bytes, offset, length) {
  return new DataView(bytes.buffer, Number(bytes.byteOffset) + Number(offset), Number(length));
}

function summarizeToc(entries) {
  return entries.map((entry) => ({
    label: entry.label,
    href: entry.href,
    children: summarizeToc(entry.children),
  }));
}

function summarizeChapters(document, result) {
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  return document.packageDocument.spine.map((spine) => {
    const href = manifestById.get(spine.idref)?.href ?? '';
    const range = result.chapterMap.get(spine.idref);
    const xhtml = document.readChapter(spine.idref) ?? '';
    return {
      idref: spine.idref,
      href,
      linear: spine.linear,
      textLength: xhtml.length,
      textHash: hashText(xhtml),
      startPage: range?.startPage ?? null,
      endPage: range?.endPage ?? null,
    };
  });
}

function summarizeXhtml(document, advanced) {
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  const chapters = document.packageDocument.spine.map((spine) => {
    const href = manifestById.get(spine.idref)?.href ?? '';
    const parsed = advanced.parseXhtml(document.readChapter(spine.idref) ?? '');
    const detail = normalizeParseResult(parsed);
    return {
      idref: spine.idref,
      href,
      ...summarizeParseDetail(detail),
      detailHash: hashJson(detail),
    };
  });

  return {
    chapterCount: chapters.length,
    chapters,
    fullDetailHash: hashJson(
      chapters.map(({ detailHash, idref, href }) => ({ detailHash, href, idref })),
    ),
  };
}

function summarizeCss(document, advanced) {
  const stylesheets = [...document.stylesheets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([href, css]) => summarizeStylesheetCss(href, css, advanced));

  return {
    stylesheetCount: stylesheets.length,
    stylesheets,
    fullDetailHash: hashJson(
      stylesheets.map(({ detailHash, href }) => ({
        detailHash,
        href,
      })),
    ),
  };
}

function summarizeStyle(document, advanced, layout, core, styleContext) {
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  const chapters = document.packageDocument.spine.map((spine) => {
    const href = manifestById.get(spine.idref)?.href ?? '';
    const parsed = advanced.parseXhtml(document.readChapter(spine.idref) ?? '');
    const resolved = core.resolveFixtureChapterStyleTree(parsed, layout, styleContext);
    return summarizeStyleForChapter(spine.idref, href, parsed, resolved, advanced);
  });

  return {
    selectorMatches: {
      chapterCount: chapters.length,
      totalElementCount: sumBy(chapters, (chapter) => chapter.elementCount),
      totalMatchedElementCount: sumBy(chapters, (chapter) => chapter.matchedElementCount),
      totalMatchCount: sumBy(chapters, (chapter) => chapter.matchCount),
      chapters,
      fullDetailHash: hashJson(
        chapters.map(({ detailHash, href, idref }) => ({
          detailHash,
          href,
          idref,
        })),
      ),
    },
    computedStyles: {
      chapterCount: chapters.length,
      totalStyledNodeCount: sumBy(chapters, (chapter) => chapter.styledNodeCount),
      chapters: chapters.map((chapter) => ({
        idref: chapter.idref,
        href: chapter.href,
        styledNodeCount: chapter.styledNodeCount,
        styleHash: chapter.styleHash,
        samples: chapter.styleSamples,
        detailHash: chapter.styleDetailHash,
      })),
      fullDetailHash: hashJson(
        chapters.map(({ href, idref, styleDetailHash }) => ({
          detailHash: styleDetailHash,
          href,
          idref,
        })),
      ),
    },
  };
}

function summarizeLayout(document, advanced, config, core, styleContext) {
  const { layout, lineBreaking } = config;
  const imageSizes = createImageSizeResolver(document.images);
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  const chapterSummaries = document.packageDocument.spine.map((spine) => {
    const href = manifestById.get(spine.idref)?.href ?? '';
    const parsed = advanced.parseXhtml(document.readChapter(spine.idref) ?? '');
    const { styled } = core.resolveFixtureChapterStyleTree(parsed, layout, styleContext);
    return {
      inlineSegments: summarizeInlineSegmentsForChapter(
        spine.idref,
        href,
        styled,
        imageSizes,
        advanced,
      ),
      lineBreakInputs: summarizeLineBreakInputsForChapter(
        spine.idref,
        href,
        styled,
        imageSizes,
        advanced,
      ),
      lineBoxes: summarizeLineBoxesForChapter(
        spine.idref,
        href,
        styled,
        imageSizes,
        advanced,
        layout,
        lineBreaking,
      ),
      continuousBlocks: summarizeContinuousBlocksForChapter(
        spine.idref,
        href,
        styled,
        imageSizes,
        advanced,
        layout,
        lineBreaking,
      ),
    };
  });
  const inlineSegmentChapters = chapterSummaries.map((chapter) => chapter.inlineSegments);
  const lineBreakInputChapters = chapterSummaries.map((chapter) => chapter.lineBreakInputs);
  const lineBoxChapters = chapterSummaries.map((chapter) => chapter.lineBoxes);
  const continuousBlockChapters = chapterSummaries.map((chapter) => chapter.continuousBlocks);

  return {
    inlineSegments: {
      chapterCount: inlineSegmentChapters.length,
      totalBlockCount: sumBy(inlineSegmentChapters, (chapter) => chapter.blockCount),
      totalSegmentCount: sumBy(inlineSegmentChapters, (chapter) => chapter.segmentCount),
      totalAtomCount: sumBy(inlineSegmentChapters, (chapter) => chapter.atomCount),
      chapters: inlineSegmentChapters,
      fullDetailHash: hashJson(
        inlineSegmentChapters.map(({ detailHash, href, idref }) => ({
          detailHash,
          href,
          idref,
        })),
      ),
    },
    lineBreakInputs: {
      chapterCount: lineBreakInputChapters.length,
      totalBlockCount: sumBy(lineBreakInputChapters, (chapter) => chapter.blockCount),
      totalRangeCount: sumBy(lineBreakInputChapters, (chapter) => chapter.rangeCount),
      totalAtomCount: sumBy(lineBreakInputChapters, (chapter) => chapter.atomCount),
      chapters: lineBreakInputChapters,
      fullDetailHash: hashJson(
        lineBreakInputChapters.map(({ detailHash, href, idref }) => ({
          detailHash,
          href,
          idref,
        })),
      ),
    },
    lineBoxes: {
      chapterCount: lineBoxChapters.length,
      totalBlockCount: sumBy(lineBoxChapters, (chapter) => chapter.blockCount),
      totalLineCount: sumBy(lineBoxChapters, (chapter) => chapter.lineCount),
      totalRunCount: sumBy(lineBoxChapters, (chapter) => chapter.runCount),
      totalAtomCount: sumBy(lineBoxChapters, (chapter) => chapter.atomCount),
      totalRubyCount: sumBy(lineBoxChapters, (chapter) => chapter.rubyCount),
      chapters: lineBoxChapters,
      fullDetailHash: hashJson(
        lineBoxChapters.map(({ detailHash, href, idref }) => ({
          detailHash,
          href,
          idref,
        })),
      ),
    },
    continuousBlocks: {
      chapterCount: continuousBlockChapters.length,
      totalTopLevelBlockCount: sumBy(
        continuousBlockChapters,
        (chapter) => chapter.topLevelBlockCount,
      ),
      totalLineCount: sumBy(continuousBlockChapters, (chapter) => chapter.lineCount),
      totalTextRunCount: sumBy(continuousBlockChapters, (chapter) => chapter.textRunCount),
      totalImageCount: sumBy(continuousBlockChapters, (chapter) => chapter.imageCount),
      totalHrCount: sumBy(continuousBlockChapters, (chapter) => chapter.hrCount),
      chapters: continuousBlockChapters,
      fullDetailHash: hashJson(
        continuousBlockChapters.map(({ detailHash, href, idref }) => ({
          detailHash,
          href,
          idref,
        })),
      ),
    },
    paginationFlow: summarizePaginationFlow(
      document,
      advanced,
      layout,
      lineBreaking,
      core,
      styleContext,
    ),
  };
}

function summarizeInlineSegmentsForChapter(idref, href, styled, imageSizes, advanced) {
  const blocks = [];
  collectInlineSegmentBlocks(styled, blocks, imageSizes, advanced);
  return {
    idref,
    href,
    blockCount: blocks.length,
    segmentCount: sumBy(blocks, (block) => block.segmentCount),
    atomCount: sumBy(blocks, (block) => block.atomCount),
    textHash: hashText(blocks.map((block) => block.text).join('')),
    blocks: blocks.map(blockSummary),
    samples: blocks.slice(0, BLOCK_SAMPLE_LIMIT).map(blockSample),
    detailHash: hashJson(blocks.map(blockSummary)),
  };
}

function blockSummary(block) {
  const summary = { ...block };
  delete summary.segments;
  delete summary.text;
  return summary;
}

function blockSample(block) {
  const sample = { ...block };
  delete sample.text;
  return sample;
}

function summarizeLineBreakInputsForChapter(idref, href, styled, imageSizes, advanced) {
  const blocks = [];
  collectLineBreakInputBlocks(styled, blocks, imageSizes, advanced);
  return {
    idref,
    href,
    blockCount: blocks.length,
    rangeCount: sumBy(blocks, (block) => block.rangeCount),
    atomCount: sumBy(blocks, (block) => block.atomCount),
    fullTextHash: hashText(blocks.map((block) => block.fullText).join('')),
    blocks: blocks.map(lineBreakInputBlockSummary),
    samples: blocks.slice(0, BLOCK_SAMPLE_LIMIT).map(lineBreakInputBlockSample),
    detailHash: hashJson(blocks.map(lineBreakInputBlockSummary)),
  };
}

function collectLineBreakInputBlocks(nodes, output, imageSizes, advanced) {
  for (const node of nodes) {
    if (node.type === 'block') {
      const segments = advanced.flattenInlineContent(node.children, imageSizes, node.href);
      if (segments.length > 0) {
        output.push(lineBreakInputBlock(node, segments));
      }
    }
    collectLineBreakInputBlocks(node.children, output, imageSizes, advanced);
  }
}

function lineBreakInputBlock(node, segments) {
  const input = buildLineBreakInput(segments);
  const detail = {
    fullText: {
      hash: hashText(input.fullText),
      length: input.fullText.length,
    },
    ranges: input.ranges,
    atoms: input.atoms,
  };
  return {
    path: node.sourceRef?.nodePath ?? null,
    tag: node.tag ?? null,
    fullTextHash: detail.fullText.hash,
    fullTextLength: detail.fullText.length,
    rangeCount: input.ranges.length,
    atomCount: input.atoms.length,
    detailHash: hashJson(detail),
    input: detail,
    fullText: input.fullText,
  };
}

function buildLineBreakInput(segments) {
  const textParts = [];
  const ranges = [];
  const atoms = [];
  let offset = 0;

  for (const segment of segments) {
    if (segment.type === 'inline-atom') {
      textParts.push('\uFFFC');
      atoms.push(normalizeLineBreakAtom(offset, segment));
      ranges.push({
        start: offset,
        end: offset + 1,
        style: summarizeSegmentStyle(segment.style),
      });
      offset += 1;
      continue;
    }

    const text = textValue(segment.text);
    textParts.push(text);
    if (text.length === 0) continue;
    ranges.push(normalizeLineBreakRange(offset, segment));
    offset += text.length;
  }

  return {
    fullText: textParts.join(''),
    ranges,
    atoms,
  };
}

function normalizeLineBreakRange(offset, segment) {
  const start = numberValue(offset);
  const text = textValue(segment.text);
  return toJsonValue({
    start,
    end: start + text.length,
    href: segment.href,
    sourcePath: segment.sourceRef?.nodePath,
    sourceText: segment.sourceText
      ? { length: segment.sourceText.length, hash: hashText(segment.sourceText) }
      : undefined,
    rubyAnnotation: segment.rubyAnnotation,
    borderStart: segment.borderStart,
    borderEnd: segment.borderEnd,
    inlineMarginLeft: segment.inlineMarginLeft,
    inlineMarginRight: segment.inlineMarginRight,
    style: summarizeSegmentStyle(segment.style),
  });
}

function normalizeLineBreakAtom(offset, segment) {
  return toJsonValue({
    offset,
    width: segment.width,
    height: segment.height,
    imageSrc: segment.imageSrc,
    alt: segment.alt,
    href: segment.href,
    sourcePath: segment.sourceNode?.sourceRef?.nodePath,
    style: summarizeSegmentStyle(segment.style),
  });
}

function lineBreakInputBlockSummary(block) {
  const summary = { ...block };
  delete summary.input;
  delete summary.fullText;
  return summary;
}

function lineBreakInputBlockSample(block) {
  const sample = { ...block };
  delete sample.fullText;
  return sample;
}

function summarizeLineBoxesForChapter(
  idref,
  href,
  styled,
  imageSizes,
  advanced,
  layout,
  lineBreaking,
) {
  const blocks = [];
  const layouter = createFixtureLayouter(advanced, lineBreaking);
  const maxWidth = layout.pageWidth - layout.marginLeft - layout.marginRight;
  collectLineBoxBlocks(styled, blocks, imageSizes, advanced, layouter, maxWidth);
  return {
    idref,
    href,
    blockCount: blocks.length,
    lineCount: sumBy(blocks, (block) => block.lineCount),
    runCount: sumBy(blocks, (block) => block.runCount),
    atomCount: sumBy(blocks, (block) => block.atomCount),
    rubyCount: sumBy(blocks, (block) => block.rubyCount),
    textHash: hashText(blocks.map((block) => block.text).join('')),
    blocks: blocks.map(lineBoxBlockSummary),
    samples: blocks.slice(0, BLOCK_SAMPLE_LIMIT).map(lineBoxBlockSample),
    detailHash: hashJson(blocks.map(lineBoxBlockSummary)),
  };
}

function collectLineBoxBlocks(nodes, output, imageSizes, advanced, layouter, maxWidth) {
  for (const node of nodes) {
    if (node.type === 'block') {
      const segments = advanced.flattenInlineContent(node.children, imageSizes, node.href);
      if (segments.length > 0) {
        const lines = layouter.layoutParagraph(segments, maxWidth, 0);
        output.push(lineBoxBlock(node, lines));
      }
    }
    collectLineBoxBlocks(node.children, output, imageSizes, advanced, layouter, maxWidth);
  }
}

function lineBoxBlock(node, lines) {
  const detail = lines.map(normalizeLineBox);
  const text = lines.map(lineText).join('');
  const block = {
    path: node.sourceRef?.nodePath ?? null,
    tag: node.tag ?? null,
    lineCount: lines.length,
    runCount: sumBy(lines, (line) => line.runs.filter((run) => run.type === 'text-run').length),
    atomCount: sumBy(lines, (line) => line.runs.filter((run) => run.type === 'inline-atom').length),
    rubyCount: sumBy(
      lines,
      (line) => line.runs.filter((run) => run.type === 'ruby-annotation').length,
    ),
    textHash: hashText(text),
    totalHeight: roundNumber(sumBy(lines, (line) => line.bounds.height)),
    maxUsedWidth: roundNumber(Math.max(0, ...lines.map(lineUsedWidth))),
    detailHash: hashJson(detail),
    lines: detail,
    text,
  };
  return block;
}

function normalizeLineBox(line) {
  return {
    bounds: summarizeRect(line.bounds),
    runs: line.runs.map(normalizeLineRun),
  };
}

function normalizeLineRun(run) {
  if (run.type === 'text-run') {
    return toJsonValue({
      type: 'text-run',
      text: {
        length: run.text.length,
        hash: hashText(run.text),
      },
      bounds: summarizeRect(run.bounds),
      href: run.href,
      sourcePath: run.sourceRef?.nodePath,
      sourceTextOffset: run.sourceTextOffset,
      inlineMarginRight: run.inlineMarginRight,
    });
  }
  if (run.type === 'inline-atom') {
    return toJsonValue({
      type: 'inline-atom',
      bounds: summarizeRect(run.bounds),
      imageSrc: run.imageSrc,
      alt: run.alt,
      href: run.href,
    });
  }
  return toJsonValue({
    type: 'ruby-annotation',
    text: {
      length: run.text.length,
      hash: hashText(run.text),
    },
    bounds: summarizeRect(run.bounds),
  });
}

function lineText(line) {
  return line.runs
    .filter((run) => run.type === 'text-run')
    .map((run) => run.text)
    .join('');
}

function lineUsedWidth(line) {
  return Math.max(0, ...line.runs.map(runRight));
}

function runRight(run) {
  return numberValue(run.bounds.x) + numberValue(run.bounds.width);
}

function textValue(value) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value) {
  return typeof value === 'number' ? value : 0;
}

function lineBoxBlockSummary(block) {
  const summary = { ...block };
  delete summary.lines;
  delete summary.text;
  return summary;
}

function lineBoxBlockSample(block) {
  const sample = { ...block };
  delete sample.text;
  return sample;
}

function summarizeContinuousBlocksForChapter(
  idref,
  href,
  styled,
  imageSizes,
  advanced,
  layout,
  lineBreaking,
) {
  const layouter = createFixtureLayouter(advanced, lineBreaking);
  const contentWidth = layout.pageWidth - layout.marginLeft - layout.marginRight;
  const contentHeight = layout.pageHeight - layout.marginTop - layout.marginBottom;
  const blocks = advanced.layoutBlocks(styled, contentWidth, layouter, imageSizes, contentHeight);
  const summaries = blocks.map(summarizeContinuousBlock);
  const aggregate = aggregateContinuousBlocks(blocks);

  return {
    idref,
    href,
    topLevelBlockCount: blocks.length,
    lineCount: aggregate.lineCount,
    textRunCount: aggregate.textRunCount,
    imageCount: aggregate.imageCount,
    hrCount: aggregate.hrCount,
    textHash: hashText(aggregate.text),
    maxBlockBottom: roundNumber(Math.max(0, ...blocks.map(blockBottom))),
    blocks: summaries,
    samples: summaries.slice(0, BLOCK_SAMPLE_LIMIT),
    detailHash: hashJson(summaries),
  };
}

function summarizeContinuousBlock(block) {
  const aggregate = aggregateContinuousBlocks([block]);
  return toJsonValue({
    bounds: summarizeRect(block.bounds),
    semanticTag: block.semanticTag,
    anchorId: block.anchorId,
    childCount: block.children.length,
    nestedBlockCount: aggregate.nestedBlockCount,
    lineCount: aggregate.lineCount,
    textRunCount: aggregate.textRunCount,
    imageCount: aggregate.imageCount,
    hrCount: aggregate.hrCount,
    textHash: hashText(aggregate.text),
    pageBreakBefore: block.pageBreakBefore,
    pageBreakAfter: block.pageBreakAfter,
    childDetailHash: hashJson(block.children.map(summarizeContinuousChild)),
    children: block.children.map(summarizeContinuousChild),
  });
}

function summarizeContinuousChild(child) {
  if (child.type === 'layout-block') {
    const summary = summarizeContinuousBlock(child);
    delete summary.children;
    return summary;
  }
  if (child.type === 'line-box') {
    return {
      type: 'line-box',
      bounds: summarizeRect(child.bounds),
      runCount: child.runs.length,
      textHash: hashText(lineText(child)),
      usedWidth: roundNumber(lineUsedWidth(child)),
    };
  }
  if (child.type === 'image') {
    return toJsonValue({
      type: 'image',
      bounds: summarizeRect(child.bounds),
      src: child.src,
      alt: child.alt,
      href: child.href,
    });
  }
  return {
    type: 'hr',
    bounds: summarizeRect(child.bounds),
    paint: toJsonValue(child.paint),
  };
}

function aggregateContinuousBlocks(blocks) {
  const aggregate = {
    nestedBlockCount: 0,
    lineCount: 0,
    textRunCount: 0,
    imageCount: 0,
    hrCount: 0,
    textParts: [],
  };

  for (const block of blocks) {
    aggregateBlock(block, aggregate);
  }

  return {
    nestedBlockCount: aggregate.nestedBlockCount,
    lineCount: aggregate.lineCount,
    textRunCount: aggregate.textRunCount,
    imageCount: aggregate.imageCount,
    hrCount: aggregate.hrCount,
    text: aggregate.textParts.join(''),
  };
}

function aggregateBlock(block, aggregate) {
  aggregate.nestedBlockCount = countValue(aggregate.nestedBlockCount) + 1;
  for (const child of block.children) {
    if (child.type === 'layout-block') {
      aggregateBlock(child, aggregate);
    } else if (child.type === 'line-box') {
      aggregate.lineCount = countValue(aggregate.lineCount) + 1;
      for (const run of child.runs) {
        if (run.type === 'text-run') {
          aggregate.textRunCount = countValue(aggregate.textRunCount) + 1;
          aggregate.textParts.push(run.text);
        } else if (run.type === 'inline-atom' && run.imageSrc) {
          aggregate.imageCount = countValue(aggregate.imageCount) + 1;
        }
      }
    } else if (child.type === 'image') {
      aggregate.imageCount = countValue(aggregate.imageCount) + 1;
    } else if (child.type === 'hr') {
      aggregate.hrCount = countValue(aggregate.hrCount) + 1;
    }
  }
}

function blockBottom(block) {
  return numberValue(block.bounds.y) + numberValue(block.bounds.height);
}

function summarizePaginationFlow(document, advanced, layout, lineBreaking, core, styleContext) {
  const imageSizes = createImageSizeResolver(document.images);
  const parsedChapters = collectParsedPaginationChapters(document, advanced);
  const hrefMap = advanced.buildManifestHrefMap(
    document.packageDocument.manifest,
    document.packageDocument.spine,
  );
  const { filteredChapters } = advanced.extractAllFootnotes(
    new Map([...parsedChapters.entries()].map(([idref, chapter]) => [idref, chapter.parsed.nodes])),
    hrefMap,
  );
  const pageDetails = [];
  const flowPages = [];
  const chapterMap = {};

  for (const spine of document.packageDocument.spine) {
    const chapter = parsedChapters.get(spine.idref);
    if (!chapter) continue;
    const parsed = {
      ...chapter.parsed,
      nodes: filteredChapters.get(spine.idref) ?? chapter.parsed.nodes,
    };
    const { chapterBodyStyle, styled } = core.resolveFixtureChapterStyleTree(
      parsed,
      layout,
      styleContext,
    );
    const contentWidth = layout.pageWidth - layout.marginLeft - layout.marginRight;
    const contentHeight = layout.pageHeight - layout.marginTop - layout.marginBottom;
    const layouter = createFixtureLayouter(advanced, lineBreaking);
    const blocks = advanced.layoutBlocks(styled, contentWidth, layouter, imageSizes, contentHeight);
    const rawPages = advanced.paginateBlocks(blocks, layout);
    if (rawPages.length === 0) continue;

    const startPage = pageDetails.length;
    for (const page of rawPages) {
      const indexedPage = withPagePaint({ ...page, index: pageDetails.length }, chapterBodyStyle);
      pageDetails.push(summarizePaginationFlowPage(indexedPage));
      flowPages.push(indexedPage);
    }
    chapterMap[spine.idref] = {
      startPage,
      endPage: pageDetails.length - 1,
      pageCount: rawPages.length,
      blockCount: blocks.length,
    };
  }

  return {
    pageCount: pageDetails.length,
    chapterMap,
    totals: totalFlowPageCounts(pageDetails),
    pageDigests: pageDetails.map((detail) => ({
      index: detail.index,
      counts: detail.counts,
      firstText: detail.firstText,
      lastText: detail.lastText,
      detailHash: hashJson(detail),
    })),
    samples: chooseSamplePageIndicesFromChapterMap(pageDetails.length, chapterMap).map(
      (index) => pageDetails[index],
    ),
    spreadFlow: summarizeSpreadFlow(pageDetails.length, chapterMap, layout),
    displayListFlow: summarizeDisplayListFlow(flowPages, chapterMap, layout, core),
    hitMapFlow: summarizeHitMapFlow(flowPages, chapterMap, advanced),
    textPositionFlow: summarizeTextPositionFlow(flowPages, chapterMap, advanced),
    linkMapFlow: summarizeLinkMapFlow(flowPages, chapterMap, advanced),
    searchFlow: summarizeSearchFlow(flowPages, advanced),
    fullDetailHash: hashJson(pageDetails),
  };
}

function createFixtureLayouter(advanced, lineBreaking) {
  return lineBreaking === 'optimal'
    ? advanced.createKnuthPlassLayouter(createFixtureTextMeasurer())
    : advanced.createGreedyLayouter(createFixtureTextMeasurer());
}

function collectParsedPaginationChapters(document, advanced) {
  const manifestById = new Map(document.packageDocument.manifest.map((item) => [item.id, item]));
  const parsed = new Map();
  for (const spine of document.packageDocument.spine) {
    const href = manifestById.get(spine.idref)?.href ?? '';
    const source = document.readChapter(spine.idref);
    if (!href || source === undefined) continue;
    parsed.set(spine.idref, { parsed: advanced.parseXhtml(source) });
  }
  return parsed;
}

function withPagePaint(page, bodyStyle) {
  const backgroundColor = bodyStyle.backgroundColor || undefined;
  return backgroundColor ? { ...page, paint: { backgroundColor } } : page;
}

function summarizeSpreadFlow(pageCount, chapterMap, layout) {
  const spreads = buildSpreadFlow(pageCount, chapterMap, layout).map((spread) =>
    toJsonValue(spread),
  );
  return {
    pageCount,
    spreadCount: spreads.length,
    spreads,
    samples: chooseSampleSpreadIndices(spreads.length).map((index) => spreads[index]),
    fullDetailHash: hashJson(spreads),
  };
}

function buildSpreadFlow(pageCount, chapterMap, layout) {
  if (pageCount <= 0) return [];
  if (layout.spreadMode === 'single') {
    return Array.from({ length: pageCount }, (_, index) => ({
      index,
      leftPageIndex: index,
      pageIndexes: [index],
      rightPageIndex: null,
    }));
  }

  const chapterStartPages = new Set(
    Object.values(chapterMap).map((range) => countValue(range.startPage)),
  );
  const spreads = [];
  let pageIndex = 0;
  if (layout.firstPageAlone && pageCount > 0) {
    spreads.push({
      index: spreads.length,
      leftPageIndex: 0,
      pageIndexes: [0],
      rightPageIndex: null,
    });
    pageIndex = 1;
  }
  while (pageIndex < pageCount) {
    const rightPageIndex = pageIndex + 1 < pageCount ? pageIndex + 1 : null;
    const includeRight = rightPageIndex !== null && !chapterStartPages.has(rightPageIndex);
    spreads.push({
      index: spreads.length,
      leftPageIndex: pageIndex,
      pageIndexes: includeRight ? [pageIndex, rightPageIndex] : [pageIndex],
      rightPageIndex: includeRight ? rightPageIndex : null,
    });
    pageIndex += includeRight ? 2 : 1;
  }
  return spreads;
}

function summarizeDisplayListFlow(pages, chapterMap, layout, core) {
  const spreads = buildSpreadFlow(pages.length, chapterMap, layout);
  const details = spreads.map((spread) =>
    summarizeDisplayListFlowSpread(spread, pages, layout, core),
  );
  return {
    spreadCount: details.length,
    spreadDigests: details,
    samples: chooseSampleSpreadIndices(details.length).map((index) => details[index]),
    fullDetailHash: hashJson(details),
  };
}

function summarizeDisplayListFlowSpread(spread, pages, layout, core) {
  const displayList = core.buildSpreadDisplayList(displayListFlowSpread(spread, pages), layout, {
    backgroundColor: '#ffffff',
  });
  const commands = displayList.commands.map((command) =>
    normalizeDisplayListFlowCommand(command, 'summary'),
  );
  const renderCommands = displayList.commands.map((command) =>
    normalizeDisplayListFlowCommand(command, 'render-command'),
  );
  return {
    spreadIndex: spread.index,
    pageIndexes: spread.pageIndexes,
    width: roundNumber(displayList.width),
    height: roundNumber(displayList.height),
    commandCount: displayList.commands.length,
    commandCounts: countBy(displayList.commands, (command) => command.kind),
    commandHash: hashJson(commands),
    renderCommandHash: hashJson(renderCommands),
    resourceRefs: summarizeDisplayListFlowResourceRefs(commands),
  };
}

function displayListFlowSpread(spread, pages) {
  return {
    index: spread.index,
    left: pages[spread.leftPageIndex],
    ...(spread.rightPageIndex === null ? {} : { right: pages[spread.rightPageIndex] }),
  };
}

function normalizeDisplayListFlowCommand(command, sourceTextMode) {
  if (command.kind !== 'paintText' && command.kind !== 'paintRuby') {
    return canonicalizeColorKeys(toJsonValue(command));
  }
  const normalized = {
    ...toJsonValue(command),
    text: {
      length: command.text.length,
      hash: hashDisplayListText(command.text),
    },
  };
  if (sourceTextMode === 'summary' && command.sourceText !== undefined) {
    normalized.sourceText = {
      length: command.sourceText.length,
      hash: hashDisplayListText(command.sourceText),
    };
  }
  return canonicalizeColorKeys(normalized);
}

function summarizeDisplayListFlowResourceRefs(commands) {
  const imageRefs = [];
  for (const command of commands) {
    if (command.kind === 'paintImage' && command.src) {
      imageRefs.push(command.src);
    }
    const backgroundImage = command.paint?.background?.image;
    if (command.kind === 'paintBlock' && backgroundImage) {
      imageRefs.push(backgroundImage);
    }
  }
  const images = [...new Set(imageRefs)].sort((left, right) => left.localeCompare(right));
  return {
    imageRefs: imageRefs.length,
    uniqueImages: images.length,
    imageHash: hashJson(images),
    images,
  };
}

function summarizeHitMapFlow(pages, chapterMap, advanced) {
  const details = pages.map((page) => summarizeHitMapFlowPage(page, advanced.buildHitMap(page)));
  return {
    pageCount: details.length,
    totals: totalHitMapCounts(details),
    pageDigests: details.map((detail) => ({
      index: detail.index,
      counts: detail.counts,
      textHash: detail.textHash,
      detailHash: hashJson(detail),
    })),
    samples: chooseSamplePageIndicesFromChapterMap(details.length, chapterMap).map(
      (index) => details[index],
    ),
    fullDetailHash: hashJson(details),
  };
}

function summarizeTextPositionFlow(pages, chapterMap, advanced) {
  const index = advanced.buildSearchIndex(pages);
  const details = index.pages.map(summarizeTextPositionFlowPage);
  return {
    pageCount: details.length,
    totals: totalTextPositionCounts(details),
    pageDigests: details.map((detail) => ({
      index: detail.index,
      textLength: detail.text.length,
      textHash: detail.text.hash,
      offsetCount: detail.offsets.length,
      offsetHash: hashJson(detail.offsets),
      detailHash: hashJson(detail),
    })),
    samples: chooseSamplePageIndicesFromChapterMap(details.length, chapterMap).map(
      (sampleIndex) => details[sampleIndex],
    ),
    fullDetailHash: hashJson(details),
  };
}

function summarizeTextPositionFlowPage(pageText) {
  return {
    index: pageText.pageIndex,
    text: {
      length: pageText.text.length,
      hash: hashText(pageText.text),
    },
    offsets: pageText.offsets.map((offset) => ({
      start: offset.start,
      end: offset.end,
      blockIndex: offset.blockIndex,
      lineIndex: offset.lineIndex,
      runIndex: offset.runIndex,
    })),
  };
}

function totalTextPositionCounts(details) {
  return details.reduce(
    (acc, detail) => ({
      textLength: countValue(acc.textLength) + countValue(detail.text.length),
      runOffsets: countValue(acc.runOffsets) + countValue(detail.offsets.length),
    }),
    { textLength: 0, runOffsets: 0 },
  );
}

function summarizeHitMapFlowPage(page, hitMap) {
  const entries = hitMap.entries.map(normalizeHitEntry);
  return {
    index: page.index,
    counts: countHitMapEntries(entries),
    textHash: hashText(hitMap.entries.map((entry) => entry.text).join('')),
    entries,
  };
}

function normalizeHitEntry(entry) {
  return toJsonValue({
    bounds: summarizeRect(entry.bounds),
    blockIndex: entry.blockIndex,
    lineIndex: entry.lineIndex,
    runIndex: entry.runIndex,
    text: {
      length: entry.text.length,
      hash: hashText(entry.text),
    },
    href: entry.href,
    sourcePath: entry.sourceRef?.nodePath,
    sourceTextOffset: entry.sourceTextOffset,
    imageSrc: entry.imageSrc,
    imageAlt: entry.imageAlt,
  });
}

function totalHitMapCounts(details) {
  return details.reduce((acc, detail) => addHitMapCounts(acc, detail.counts), emptyHitMapCounts());
}

function countHitMapEntries(entries) {
  return entries.reduce((acc, entry) => {
    const text = entry.text;
    return addHitMapCounts(acc, {
      entries: 1,
      textEntries: text && countValue(text.length) > 0 ? 1 : 0,
      imageEntries: entry.imageSrc ? 1 : 0,
      linkEntries: entry.href ? 1 : 0,
      sourceRefs: Array.isArray(entry.sourcePath) ? 1 : 0,
    });
  }, emptyHitMapCounts());
}

function emptyHitMapCounts() {
  return { entries: 0, textEntries: 0, imageEntries: 0, linkEntries: 0, sourceRefs: 0 };
}

function addHitMapCounts(left, right) {
  return {
    entries: countValue(left.entries) + countValue(right.entries),
    textEntries: countValue(left.textEntries) + countValue(right.textEntries),
    imageEntries: countValue(left.imageEntries) + countValue(right.imageEntries),
    linkEntries: countValue(left.linkEntries) + countValue(right.linkEntries),
    sourceRefs: countValue(left.sourceRefs) + countValue(right.sourceRefs),
  };
}

function summarizeLinkMapFlow(pages, chapterMap, advanced) {
  const details = pages.map((page) => summarizeLinkMapFlowPage(page, advanced.buildLinkMap(page)));
  return {
    pageCount: details.length,
    totals: totalLinkMapCounts(details),
    pageDigests: details.map((detail) => ({
      index: detail.index,
      regionCount: detail.regions.length,
      textLength: detail.textLength,
      detailHash: hashJson(detail),
    })),
    samples: chooseSamplePageIndicesFromChapterMap(details.length, chapterMap).map(
      (sampleIndex) => details[sampleIndex],
    ),
    fullDetailHash: hashJson(details),
  };
}

function summarizeLinkMapFlowPage(page, regions) {
  const normalizedRegions = regions.map((region) =>
    toJsonValue({
      bounds: summarizeRect(region.bounds),
      href: region.href,
      text: {
        length: region.text.length,
        hash: hashText(region.text),
      },
    }),
  );
  return {
    index: page.index,
    textLength: sumBy(normalizedRegions, (region) => region.text?.length),
    regions: normalizedRegions,
  };
}

function totalLinkMapCounts(details) {
  return details.reduce(
    (acc, detail) => ({
      regions: countValue(acc.regions) + countValue(detail.regions.length),
      textLength: countValue(acc.textLength) + countValue(detail.textLength),
    }),
    { regions: 0, textLength: 0 },
  );
}

function summarizeSearchFlow(pages, advanced) {
  const index = advanced.buildSearchIndex(pages);
  const queries = SEARCH_QUERY_SPECS.map((spec) => summarizeSearchQuery(index, spec, advanced));
  return {
    queryCount: queries.length,
    resultCount: sumBy(queries, (query) => query.resultCount),
    queries,
    fullDetailHash: hashJson(queries),
  };
}

function summarizeSearchQuery(index, spec, advanced) {
  const results = advanced
    .search(index, spec.query, {
      caseSensitive: spec.caseSensitive,
      wholeWord: spec.wholeWord,
    })
    .map(normalizeSearchResult);
  return {
    id: spec.id,
    query: spec.query,
    caseSensitive: spec.caseSensitive,
    wholeWord: spec.wholeWord,
    resultCount: results.length,
    pageIndexes: [...new Set(results.map((result) => result.pageIndex))],
    contextHash: hashJson(results.map((result) => result.context)),
    rangeHash: hashJson(results.map(({ pageIndex, range }) => ({ pageIndex, range }))),
    samples: results.slice(0, 6),
    detailHash: hashJson(results),
  };
}

function normalizeSearchResult(result) {
  return toJsonValue({
    pageIndex: result.pageIndex,
    range: result.range,
    context: {
      length: result.context.length,
      hash: hashText(result.context),
    },
  });
}

// Deeply canonicalizes color-keyed strings inside a summary value. Only the
// dedicated color keys are touched, so text content is never rewritten.
function canonicalizeColorKeys(value) {
  if (Array.isArray(value)) return value.map(canonicalizeColorKeys);
  if (value === null || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'color' || key === 'backgroundColor') && typeof entry === 'string') {
      output[key] = canonicalSummaryColor(entry);
    } else {
      output[key] = canonicalizeColorKeys(entry);
    }
  }
  return output;
}

function summarizePaginationFlowPage(page) {
  const texts = [];
  for (const block of page.content) collectBlockText(block, texts);
  const blocks = page.content.map(summarizePaginationFlowBlock);
  return canonicalizeColorKeys({
    index: page.index,
    bounds: summarizeRect(page.bounds),
    ...(page.paint ? { paint: toJsonValue(page.paint) } : {}),
    counts: countPage(page),
    firstText: cropText(texts[0] ?? ''),
    lastText: cropText(texts[texts.length - 1] ?? ''),
    blocks,
  });
}

function summarizePaginationFlowBlock(block) {
  const childSummaries = block.children.map(summarizePaginationFlowChild);
  const aggregate = aggregatePaginationFlowBlock(block);
  return toJsonValue({
    bounds: summarizeRect(block.bounds),
    semanticTag: block.semanticTag,
    anchorId: block.anchorId,
    childCount: block.children.length,
    nestedBlockCount: aggregate.nestedBlockCount,
    lineCount: aggregate.lineCount,
    textRunCount: aggregate.textRunCount,
    imageCount: aggregate.imageCount,
    hrCount: aggregate.hrCount,
    textHash: hashText(aggregate.text),
    children: childSummaries,
    childDetailHash: hashJson(childSummaries),
  });
}

function summarizePaginationFlowChild(child) {
  if (child.type === 'layout-block') {
    const summary = summarizePaginationFlowBlock(child);
    delete summary.children;
    return summary;
  }
  if (child.type === 'line-box') {
    return {
      type: 'line-box',
      bounds: summarizeRect(child.bounds),
      runCount: child.runs.length,
      textHash: hashText(lineText(child)),
      usedWidth: roundNumber(lineUsedWidth(child)),
    };
  }
  if (child.type === 'image') {
    return toJsonValue({
      type: 'image',
      bounds: summarizeRect(child.bounds),
      src: child.src,
      alt: child.alt,
      href: child.href,
    });
  }
  return {
    type: 'hr',
    bounds: summarizeRect(child.bounds),
    paint: toJsonValue(child.paint),
  };
}

function aggregatePaginationFlowBlock(block) {
  const aggregate = {
    nestedBlockCount: 0,
    lineCount: 0,
    textRunCount: 0,
    imageCount: 0,
    hrCount: 0,
    textParts: [],
  };
  aggregatePaginationBlock(block, aggregate);
  return {
    nestedBlockCount: aggregate.nestedBlockCount,
    lineCount: aggregate.lineCount,
    textRunCount: aggregate.textRunCount,
    imageCount: aggregate.imageCount,
    hrCount: aggregate.hrCount,
    text: aggregate.textParts.join(''),
  };
}

function aggregatePaginationBlock(block, aggregate) {
  aggregate.nestedBlockCount = countValue(aggregate.nestedBlockCount) + 1;
  for (const child of block.children) {
    if (child.type === 'layout-block') {
      aggregatePaginationBlock(child, aggregate);
    } else if (child.type === 'line-box') {
      aggregate.lineCount = countValue(aggregate.lineCount) + 1;
      for (const run of child.runs) {
        if (run.type === 'text-run') {
          aggregate.textRunCount = countValue(aggregate.textRunCount) + 1;
          aggregate.textParts.push(run.text);
        } else if (run.type === 'inline-atom' && run.imageSrc) {
          aggregate.imageCount = countValue(aggregate.imageCount) + 1;
        }
      }
    } else if (child.type === 'image') {
      aggregate.imageCount = countValue(aggregate.imageCount) + 1;
    } else if (child.type === 'hr') {
      aggregate.hrCount = countValue(aggregate.hrCount) + 1;
    }
  }
}

function totalFlowPageCounts(pageDetails) {
  return pageDetails.reduce((acc, page) => addCounts(acc, page.counts), emptyCounts());
}

function chooseSamplePageIndicesFromChapterMap(pageCount, chapterMap) {
  const indices = new Set();
  addRange(indices, 0, Math.min(2, pageCount));
  addRange(indices, Math.max(pageCount - 2, 0), pageCount);
  for (const range of Object.values(chapterMap)) {
    indices.add(range.startPage);
    indices.add(range.endPage);
    if (indices.size >= 16) break;
  }
  return [...indices]
    .filter((index) => index >= 0 && index < pageCount)
    .sort((left, right) => left - right)
    .slice(0, 16);
}

function collectInlineSegmentBlocks(nodes, output, imageSizes, advanced) {
  for (const node of nodes) {
    if (node.type === 'block') {
      const rawSegments = advanced.flattenInlineContent(node.children, imageSizes, node.href);
      const segments = rawSegments.map(normalizeInlineSegment);
      if (segments.length > 0) {
        const text = rawSegments
          .filter((segment) => segment.type !== 'inline-atom')
          .map((segment) => segment.text ?? '')
          .join('');
        output.push({
          path: node.sourceRef?.nodePath ?? null,
          tag: node.tag ?? null,
          segmentCount: segments.length,
          atomCount: segments.filter((segment) => segment.type === 'inline-atom').length,
          rubyCount: segments.filter((segment) => segment.rubyAnnotation != null).length,
          textLength: text.length,
          textHash: hashText(text),
          detailHash: hashJson(segments),
          segments,
          text,
        });
      }
    }
    collectInlineSegmentBlocks(node.children, output, imageSizes, advanced);
  }
}

function normalizeInlineSegment(segment) {
  if (segment.type === 'inline-atom') {
    return toJsonValue({
      type: 'inline-atom',
      width: segment.width,
      height: segment.height,
      imageSrc: segment.imageSrc,
      alt: segment.alt,
      href: segment.href,
      sourcePath: segment.sourceNode?.sourceRef?.nodePath,
      style: summarizeSegmentStyle(segment.style),
    });
  }
  return toJsonValue({
    type: 'text',
    text: {
      length: segment.text.length,
      hash: hashText(segment.text),
    },
    href: segment.href,
    rubyAnnotation: segment.rubyAnnotation,
    sourcePath: segment.sourceRef?.nodePath,
    inlineMarginLeft: segment.inlineMarginLeft,
    inlineMarginRight: segment.inlineMarginRight,
    borderStart: segment.borderStart,
    borderEnd: segment.borderEnd,
    style: summarizeSegmentStyle(segment.style),
  });
}

// Hex color strings are canonicalized (lowercase, 3-digit expanded) so the
// summary tolerates author-case differences that cannot survive a computed-
// value pipeline. Painted output parses these strings identically.

function canonicalSummaryColor(value) {
  if (typeof value !== 'string') return value;
  const named = NAMED_COLOR_HEX[value.trim().toLowerCase()];
  if (named) return named;
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) return value;
  const digits = match[1].toLowerCase();
  return digits.length === 3
    ? `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
    : `#${digits}`;
}

function canonicalSummaryBorder(border) {
  if (border === null || typeof border !== 'object') return border;
  // A zero-width border paints nothing; its style/color are unobservable and
  // engines legitimately disagree on them (`border: 0` computes style `none`
  // per CSS but `solid` in the retired parsers).
  if (border.width === 0) return { color: '#000000', style: 'none', width: 0 };
  return { ...border, color: canonicalSummaryColor(border.color) };
}

function summarizeSegmentStyle(style) {
  return toJsonValue({
    backgroundColor: canonicalSummaryColor(style.backgroundColor),
    borderBottom: canonicalSummaryBorder(style.borderBottom),
    borderLeft: canonicalSummaryBorder(style.borderLeft),
    borderRadius: style.borderRadius,
    borderRight: canonicalSummaryBorder(style.borderRight),
    borderTop: canonicalSummaryBorder(style.borderTop),
    display: style.display,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    height: style.height,
    lineHeight: style.lineHeight,
    lineHeightPx: style.lineHeightPx,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight,
    objectFit: style.objectFit,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    paddingTop: style.paddingTop,
    textTransform: style.textTransform,
    verticalAlign: style.verticalAlign,
    width: style.width,
  });
}

function createImageSizeResolver(images) {
  const resourceMap = new Map(
    [...images.entries()]
      .map(([href, bytes]) => [href, parseImageDimensions(bytes)])
      .filter((entry) => entry[1] !== null),
  );
  const resolver = buildHrefResolver(resourceMap);
  return {
    getSize(src) {
      return resolver(src);
    },
  };
}

function buildHrefResolver(resources) {
  const byHref = new Map(resources);
  const bySuffix = new Map();
  const byBasename = new Map();

  for (const [href, value] of resources) {
    const parts = href.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const suffix = parts.slice(index).join('/');
      bySuffix.set(suffix, bySuffix.has(suffix) ? null : value);
    }

    const basename = parts.at(-1) ?? href;
    byBasename.set(basename, byBasename.has(basename) ? null : value);
  }

  return (src) => {
    const exact = byHref.get(src);
    if (exact !== undefined) return exact;

    const normalized = stripRelativePrefix(src);
    const suffixDirect = bySuffix.get(normalized);
    if (suffixDirect !== undefined && suffixDirect !== null) return suffixDirect;

    if (normalized !== src) {
      const strippedExact = byHref.get(normalized);
      if (strippedExact !== undefined) return strippedExact;
    }

    const srcParts = normalized.split('/');
    for (let index = 1; index < srcParts.length; index += 1) {
      const srcSuffix = srcParts.slice(index).join('/');
      const hrefMatch = byHref.get(srcSuffix);
      if (hrefMatch !== undefined) return hrefMatch;
    }

    const basename = srcParts.at(-1);
    if (basename) {
      const basenameMatch = byBasename.get(basename);
      if (basenameMatch !== undefined && basenameMatch !== null) return basenameMatch;
    }

    return undefined;
  };
}

function summarizeStylesheetCss(href, css, advanced) {
  const rules = advanced.parseCssRules(css, advanced.DEFAULT_STYLE.fontSize);
  const fontFaces = advanced
    .parseFontFaceRules(css)
    .map((rule) => ({
      family: rule.family,
      src: rule.src,
      style: rule.style ?? null,
      weight: rule.weight ?? null,
    }))
    .sort((left, right) => {
      const familyOrder = left.family.localeCompare(right.family);
      return familyOrder === 0 ? left.src.localeCompare(right.src) : familyOrder;
    });
  const ruleDetails = rules.map((rule) => {
    const declarations = toJsonValue(rule.declarations);
    return {
      declarationKeys: Object.keys(rule.declarations).sort(),
      declarations,
      declarationsHash: hashJson(declarations),
      origin: rule.origin,
      rawDeclarationsHash: hashText(rule.rawDeclarations),
      selector: rule.selector,
    };
  });
  const detail = {
    fontFaces,
    rules: ruleDetails,
  };

  return {
    href,
    ruleCount: ruleDetails.length,
    fontFaceCount: fontFaces.length,
    declarationKeyCounts: countBy(
      ruleDetails.flatMap((rule) => rule.declarationKeys),
      (key) => key,
    ),
    selectorHash: hashJson(ruleDetails.map((rule) => rule.selector)),
    rawDeclarationsHash: hashJson(ruleDetails.map((rule) => rule.rawDeclarationsHash)),
    declarationValueHash: hashJson(ruleDetails.map((rule) => rule.declarationsHash)),
    fontFaceHash: hashJson(fontFaces),
    detailHash: hashJson(detail),
  };
}

function summarizeStyleForChapter(idref, href, parsed, resolved, advanced) {
  const selectorDetail = collectSelectorMatches(
    parsed.nodes,
    resolved.rules,
    advanced,
    resolved.ancestors,
  );
  const styleDetail = collectComputedStyleSummary(resolved.styled);

  return {
    idref,
    href,
    elementCount: selectorDetail.elementCount,
    matchedElementCount: selectorDetail.elements.length,
    matchCount: sumBy(selectorDetail.elements, (element) => element.matchedSelectors.length),
    selectorMatchHash: hashJson(
      selectorDetail.elements.map((element) => ({
        matchedSelectors: element.matchedSelectors,
        path: element.path,
      })),
    ),
    cascadeMatchHash: hashJson(
      selectorDetail.elements.map((element) => ({
        cascadeSelectors: element.cascadeSelectors,
        path: element.path,
      })),
    ),
    detailHash: hashJson(selectorDetail),
    styledNodeCount: styleDetail.nodes.length,
    styleHash: hashJson(
      styleDetail.nodes.map((node) => ({
        path: node.path,
        style: node.style,
      })),
    ),
    styleSamples: styleDetail.nodes.slice(0, 8),
    styleDetailHash: hashJson(styleDetail),
  };
}

function stripRelativePrefix(href) {
  return href.replace(/^(?:\.\.\/)+/, '');
}

function collectSelectorMatches(nodes, rules, advanced, rootAncestors) {
  const elements = [];
  let elementCount = 0;

  function walkSiblings(siblings, ancestors) {
    const elementSiblings = siblings.filter(isElementNode);
    let siblingIndex = 0;
    let previousSibling;

    for (const node of siblings) {
      if (!isElementNode(node)) continue;

      const baseTarget = selectorTargetForNode(node);
      const target = {
        ...baseTarget,
        siblingIndex,
        siblingCount: elementSiblings.length,
        ...(previousSibling ? { previousSibling } : {}),
      };
      elementCount += 1;

      const matchedRules = rules.filter((rule) =>
        advanced.matchesSelector(target, rule.selector, ancestors),
      );
      if (matchedRules.length > 0) {
        elements.push({
          path: normalizeSourceRef(node.sourceRef)?.nodePath ?? [],
          tag: target.tag,
          id: target.id ?? null,
          className: target.className ?? null,
          matchedSelectors: matchedRules.map((rule) => rule.selector),
          cascadeSelectors: [...matchedRules]
            .sort((left, right) =>
              advanced.compareSpecificity(
                advanced.calculateSpecificity(left.selector),
                advanced.calculateSpecificity(right.selector),
              ),
            )
            .map((rule) => rule.selector),
        });
      }

      if (node.type === 'block' || node.type === 'inline') {
        walkSiblings(node.children, [target, ...ancestors]);
      }

      previousSibling = target;
      siblingIndex += 1;
    }
  }

  walkSiblings(nodes, rootAncestors);
  return { elementCount, elements };
}

function collectComputedStyleSummary(styled) {
  const summary = [];

  function walk(node) {
    summary.push({
      type: node.type,
      tag: node.tag ?? null,
      path: normalizeSourceRef(node.sourceRef)?.nodePath ?? null,
      style: summarizeComputedStyle(node.style),
    });
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of styled) {
    walk(node);
  }

  return { nodes: summary };
}

function summarizeComputedStyle(style) {
  return toJsonValue({
    backgroundColor: style.backgroundColor,
    borderBottom: style.borderBottom,
    borderLeft: style.borderLeft,
    borderRadius: style.borderRadius,
    borderRight: style.borderRight,
    borderTop: style.borderTop,
    boxSizing: style.boxSizing,
    clear: style.clear,
    color: style.color,
    display: style.display,
    float: style.float,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    height: style.height,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    lineHeightPx: style.lineHeightPx,
    listStyleType: style.listStyleType,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    marginLeftAuto: style.marginLeftAuto,
    marginRight: style.marginRight,
    marginRightAuto: style.marginRightAuto,
    marginTop: style.marginTop,
    objectFit: style.objectFit,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    paddingTop: style.paddingTop,
    textAlign: style.textAlign,
    textDecoration: style.textDecoration,
    textIndent: style.textIndent,
    verticalAlign: style.verticalAlign,
    width: style.width,
    wordBreak: style.wordBreak,
    wordSpacing: style.wordSpacing,
  });
}

function isElementNode(node) {
  return node.type === 'block' || node.type === 'inline' || node.type === 'image';
}

function selectorTargetForNode(node) {
  const tag = node.type === 'image' ? 'img' : node.tag;
  const attributes = node.attributes;
  const target = { tag };
  if (attributes?.class) target.className = attributes.class;
  if (attributes?.id) target.id = attributes.id;
  if (attributes?.allAttributes) target.attributes = attributes.allAttributes;
  return target;
}

function summarizeParseDetail(detail) {
  const textRuns = [];
  const images = [];
  const counts = emptyXhtmlCounts();
  const tagCounts = new Map();
  const attributeCounts = new Map();
  let maxDepth = 0;

  for (const node of detail.nodes) {
    walkXhtmlNode(node, 1, {
      attributeCounts,
      counts,
      images,
      onDepth(depth) {
        maxDepth = Math.max(maxDepth, depth);
      },
      tagCounts,
      textRuns,
    });
  }

  return {
    attributeCounts: mapToSortedObject(attributeCounts),
    bodyAttributes: detail.bodyAttributes,
    counts,
    embeddedStylesheets: detail.embeddedStylesheets,
    firstText: cropText(textRuns[0] ?? ''),
    imageSources: images,
    lastText: cropText(textRuns[textRuns.length - 1] ?? ''),
    maxDepth,
    stylesheetHrefs: detail.stylesheetHrefs,
    tagCounts: mapToSortedObject(tagCounts),
    textHash: hashText(textRuns.join('')),
    topLevelCount: detail.nodes.length,
    warningCount: detail.warnings.length,
    warningsHash: hashJson(detail.warnings),
  };
}

function walkXhtmlNode(node, depth, state) {
  state.onDepth(depth);
  state.counts[node.type] = countValue(state.counts[node.type]) + 1;

  if (node.tag) {
    state.tagCounts.set(node.tag, countValue(state.tagCounts.get(node.tag)) + 1);
  }
  if (node.attributes) {
    for (const key of Object.keys(node.attributes)) {
      state.attributeCounts.set(key, countValue(state.attributeCounts.get(key)) + 1);
    }
  }

  if (node.type === 'text') {
    state.textRuns.push(node.content);
    return;
  }
  if (node.type === 'image') {
    state.images.push(node.src);
    return;
  }

  for (const child of node.children) {
    walkXhtmlNode(child, countValue(depth) + 1, state);
  }
}

function emptyXhtmlCounts() {
  return { block: 0, image: 0, inline: 0, text: 0 };
}

function summarizePagination(result) {
  const pageDetails = result.pages.map((page) => summarizePage(page));
  return {
    pageCount: result.pages.length,
    chapterMap: mapToSortedObject(result.chapterMap),
    anchorMap: mapToSortedObject(result.anchorMap),
    chapterTextIndexIds: [...result.chapterTextIndices.keys()].sort(),
    footnoteKeys: [...result.footnoteMap.keys()].sort(),
    totals: totalPageCounts(result.pages),
    pageDigests: pageDetails.map((detail) => ({
      index: detail.index,
      counts: detail.counts,
      firstText: detail.firstText,
      lastText: detail.lastText,
      detailHash: hashJson(detail),
    })),
    samples: chooseSamplePageIndices(result.pages.length, result).map(
      (index) => pageDetails[index],
    ),
    fullDetailHash: hashJson(pageDetails),
  };
}

function summarizePage(page) {
  const texts = [];
  for (const block of page.content) collectBlockText(block, texts);
  return {
    index: page.index,
    bounds: summarizeRect(page.bounds),
    paint: toJsonValue(page.paint),
    counts: countPage(page),
    firstText: cropText(texts[0] ?? ''),
    lastText: cropText(texts[texts.length - 1] ?? ''),
    blocks: page.content.map((block) => summarizeBlock(block)),
  };
}

function summarizeBlock(block) {
  return {
    type: block.type,
    tag: block.semanticTag ?? null,
    anchorId: block.anchorId ?? null,
    bounds: summarizeRect(block.bounds),
    borderBox: toJsonValue(block.borderBox),
    paint: toJsonValue(block.paint),
    children: block.children.map((child) => summarizeLayoutChild(child)),
  };
}

function summarizeLayoutChild(child) {
  switch (child.type) {
    case 'line-box':
      return {
        type: child.type,
        bounds: summarizeRect(child.bounds),
        runs: child.runs.map((run) => summarizeRun(run)),
      };
    case 'layout-block':
      return summarizeBlock(child);
    case 'image':
      return {
        type: child.type,
        src: child.src,
        alt: child.alt ?? null,
        href: child.href ?? null,
        bounds: summarizeRect(child.bounds),
      };
    case 'hr':
      return {
        type: child.type,
        bounds: summarizeRect(child.bounds),
        paint: toJsonValue(child.paint),
      };
    default:
      throw new Error(`Unknown layout child type: ${String(child.type)}`);
  }
}

function summarizeRun(run) {
  if (run.type === 'text-run') {
    return {
      type: run.type,
      text: run.text,
      bounds: summarizeRect(run.bounds),
      href: run.href ?? null,
      paint: toJsonValue(run.paint),
    };
  }
  if (run.type === 'inline-atom') {
    return {
      type: run.type,
      bounds: summarizeRect(run.bounds),
      imageSrc: run.imageSrc ?? null,
      href: run.href ?? null,
      alt: run.alt ?? null,
      hasBlock: run.block !== undefined,
    };
  }
  return {
    type: run.type,
    text: run.text,
    bounds: summarizeRect(run.bounds),
    paint: toJsonValue(run.paint),
  };
}

function summarizeDisplayLists(spreads, layout, core) {
  const samples = chooseSampleSpreadIndices(spreads.length).map((index) => {
    const spread = spreads[index];
    if (!spread) throw new Error(`Missing spread ${String(index)}`);
    const displayList = core.buildSpreadDisplayList(spread, layout, { backgroundColor: '#ffffff' });
    const commands = displayList.commands.map((command) => normalizeDrawCommand(command));
    return {
      spreadIndex: index,
      pageIndexes: [spread.left?.index ?? null, spread.right?.index ?? null].filter(
        (pageIndex) => pageIndex !== null,
      ),
      width: roundNumber(displayList.width),
      height: roundNumber(displayList.height),
      commandCount: displayList.commands.length,
      commandCounts: countBy(displayList.commands, (command) => command.kind),
      commandHash: hashJson(commands),
    };
  });
  return {
    spreadCount: spreads.length,
    samples,
  };
}

function normalizeDrawCommand(command) {
  if (command.kind === 'paintText' || command.kind === 'paintRuby') {
    return {
      ...toJsonValue(command),
      text: {
        length: command.text.length,
        hash: hashDisplayListText(command.text),
      },
    };
  }
  return toJsonValue(command);
}

function countPage(page) {
  return page.content.reduce((acc, block) => addCounts(acc, countBlock(block)), emptyCounts());
}

function countBlock(block) {
  return block.children.reduce((acc, child) => addCounts(acc, countChild(child)), {
    ...emptyCounts(),
    blocks: 1,
  });
}

function countChild(child) {
  switch (child.type) {
    case 'line-box':
      return child.runs.reduce((acc, run) => addCounts(acc, countRun(run)), {
        ...emptyCounts(),
        lines: 1,
      });
    case 'layout-block':
      return countBlock(child);
    case 'image':
      return { ...emptyCounts(), images: 1 };
    case 'hr':
      return { ...emptyCounts(), hrs: 1 };
    default:
      throw new Error(`Unknown child type: ${String(child.type)}`);
  }
}

function countRun(run) {
  if (run.type === 'text-run') return { ...emptyCounts(), textRuns: 1 };
  if (run.type === 'ruby-annotation') return { ...emptyCounts(), ruby: 1 };
  return { ...emptyCounts(), inlineAtoms: 1, images: run.imageSrc ? 1 : 0 };
}

function totalPageCounts(pages) {
  return pages.reduce((acc, page) => addCounts(acc, countPage(page)), emptyCounts());
}

function emptyCounts() {
  return { blocks: 0, lines: 0, textRuns: 0, inlineAtoms: 0, images: 0, ruby: 0, hrs: 0 };
}

function addCounts(left, right) {
  return {
    blocks: countValue(left.blocks) + countValue(right.blocks),
    lines: countValue(left.lines) + countValue(right.lines),
    textRuns: countValue(left.textRuns) + countValue(right.textRuns),
    inlineAtoms: countValue(left.inlineAtoms) + countValue(right.inlineAtoms),
    images: countValue(left.images) + countValue(right.images),
    ruby: countValue(left.ruby) + countValue(right.ruby),
    hrs: countValue(left.hrs) + countValue(right.hrs),
  };
}

function collectBlockText(block, texts) {
  for (const child of block.children) {
    if (child.type === 'line-box') collectLineText(child, texts);
    else if (child.type === 'layout-block') collectBlockText(child, texts);
  }
}

function collectLineText(line, texts) {
  for (const run of line.runs) {
    if (run.type === 'text-run' && run.text.trim().length > 0) texts.push(run.text);
  }
}

function chooseSamplePageIndices(pageCount, result) {
  const indices = new Set();
  addRange(indices, 0, Math.min(2, pageCount));
  addRange(indices, Math.max(pageCount - 2, 0), pageCount);
  for (const range of result.chapterMap.values()) {
    indices.add(range.startPage);
    indices.add(range.endPage);
    if (indices.size >= 16) break;
  }
  return [...indices]
    .filter((index) => index >= 0 && index < pageCount)
    .sort((left, right) => left - right)
    .slice(0, 16);
}

function chooseSampleSpreadIndices(spreadCount) {
  const indices = new Set();
  addRange(indices, 0, Math.min(2, spreadCount));
  addRange(indices, Math.max(spreadCount - 2, 0), spreadCount);
  return [...indices].sort((left, right) => left - right);
}

function addRange(indices, start, end) {
  for (let index = start; index < end; index++) indices.add(index);
}

function mapToSortedObject(map) {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function countBy(values, keyOf) {
  const counts = new Map();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, countValue(counts.get(key)) + 1);
  }
  return mapToSortedObject(counts);
}

function countValue(value) {
  return typeof value === 'number' ? value : 0;
}

function sumBy(values, project) {
  let total = 0;
  for (const value of values) {
    total += countValue(project(value));
  }
  return total;
}

function summarizeRect(rect) {
  return {
    x: roundNumber(rect.x),
    y: roundNumber(rect.y),
    width: roundNumber(rect.width),
    height: roundNumber(rect.height),
  };
}

function createFixtureTextMeasurer(charWidthFactor = 0.6) {
  return {
    measureText(text, paint) {
      const sizePx = paint.font.sizePx;
      return {
        width:
          text.length * sizePx * charWidthFactor +
          countAsciiSpaces(text) * (paint.wordSpacingPx ?? 0) +
          countLetterSpacingGaps(text) * (paint.letterSpacingPx ?? 0),
        height: sizePx,
      };
    },
    resolveFontMetrics(paint) {
      const sizePx = paint.font.sizePx;
      return {
        ascentPx: sizePx,
        descentPx: 0,
        lineGapPx: 0,
        contentHeightPx: sizePx,
      };
    },
    clearCache() {},
  };
}

function countAsciiSpaces(text) {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ' ') count++;
  }
  return count;
}

function countLetterSpacingGaps(text) {
  const units = Array.from(text).length;
  return units > 1 ? units - 1 : 0;
}

function cropText(text) {
  return normalizeText(text).slice(0, TEXT_EDGE_LIMIT);
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function toArrayBuffer(bytes) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function toJsonValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === 'object') return objectToJsonValue(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? null;
  return null;
}

function objectToJsonValue(value) {
  const entries = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw !== undefined) entries.push([key, toJsonValue(raw)]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function roundNumber(value) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** FLOAT_DIGITS;
  return Math.round(value * factor) / factor;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function hashJson(value) {
  return hashText(stableStringify(value));
}

function hashDisplayListText(text) {
  return hashJson(text);
}

function stableStringify(value) {
  return `${stringifyJson(value, 0)}\n`;
}

function stringifyJson(value, depth) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return stringifyArray(value, depth);
  return stringifyObject(value, depth);
}

function stringifyArray(values, depth) {
  if (values.length === 0) return '[]';
  const nextDepth = Number(depth) + 1;
  const indent = spaces(nextDepth);
  const closing = spaces(depth);
  return `[\n${values.map((value) => `${indent}${stringifyJson(value, nextDepth)}`).join(',\n')}\n${closing}]`;
}

function stringifyObject(value, depth) {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return '{}';
  const nextDepth = Number(depth) + 1;
  const indent = spaces(nextDepth);
  const closing = spaces(depth);
  return `{\n${entries
    .map(([key, entry]) => `${indent}${JSON.stringify(key)}: ${stringifyJson(entry, nextDepth)}`)
    .join(',\n')}\n${closing}}`;
}

function spaces(depth) {
  return '  '.repeat(depth);
}

function parseList(value, fallback) {
  if (value === undefined || value.trim().length === 0) return fallback;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected positive integer fixture option, received: ${value}`);
  }
  return parsed;
}

async function writeFixture(relativePath, value, check) {
  const text = stableStringify(toJsonValue(value));
  const status = await writeCanonicalFixture({
    check,
    outputRoot: OUTPUT_ROOT,
    relativePath,
    text,
  });
  if (!check) console.log(`${status === 'written' ? 'wrote' : 'kept'} ${relativePath}`);
}
