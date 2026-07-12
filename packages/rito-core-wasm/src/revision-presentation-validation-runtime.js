import {
  requireMatchingRevisionSummary,
  requireObjectInput,
} from './core-wasm-versioned-validation-runtime.js';
import { requireRequiredFontFaces } from './required-font-faces-validation-runtime.js';
export function requireRevisionPresentation(value, revision, operation) {
  const presentation = requireObjectInput(value, `${operation} value`);
  const fields = new Set([
    'revision',
    'navigation',
    'tocTargets',
    'fontFamilies',
    'requiredFontFaces',
  ]);
  for (const field of Object.keys(presentation)) {
    if (!fields.has(field)) {
      throw new Error(`${operation} returned an unexpected presentation field: ${field}`);
    }
  }
  const summary = requireMatchingRevisionSummary(
    presentation.revision,
    revision,
    `${operation} presentation`,
  );
  const navigation = requirePresentationNavigation(
    presentation.navigation,
    revision,
    summary,
    operation,
  );
  const tocTargets = requireObjectInput(presentation.tocTargets, `${operation} tocTargets`);
  requireExactFields(tocTargets, new Set(['revisionId', 'targets']), `${operation} tocTargets`);
  requireMatchingRevisionId(tocTargets, revision, `${operation} tocTargets`);
  if (!Array.isArray(tocTargets.targets)) {
    throw new Error(`${operation} returned malformed presentation TOC targets`);
  }
  for (const target of tocTargets.targets) {
    const value = requireObjectInput(target, `${operation} TOC target`);
    requireExactFields(
      value,
      new Set(['entry', 'pageIndex', 'spreadIndex']),
      `${operation} TOC target`,
    );
    if (
      !isSafeCount(value.pageIndex) ||
      value.pageIndex >= summary.knownExtent.pageCount ||
      !isSafeCount(value.spreadIndex) ||
      value.spreadIndex >= summary.knownExtent.spreadCount
    ) {
      throw new Error(`${operation} returned an out-of-range presentation TOC target`);
    }
    requireTocEntry(value.entry, operation, 0);
    if (!navigation.spreads[value.spreadIndex].pageIndexes.includes(value.pageIndex)) {
      throw new Error(`${operation} returned an inconsistent presentation TOC target`);
    }
  }
  if (
    !Array.isArray(presentation.fontFamilies) ||
    presentation.fontFamilies.some((family) => typeof family !== 'string' || family.length === 0)
  ) {
    throw new Error(`${operation} returned malformed presentation font families`);
  }
  requireRequiredFontFaces(presentation.requiredFontFaces, revision.revisionId, operation);
  return presentation;
}

function requirePresentationNavigation(value, revision, summary, operation) {
  const navigation = requireObjectInput(value, `${operation} navigation`);
  requireExactFields(
    navigation,
    new Set(['revisionId', 'pageCount', 'spreadCount', 'spreads', 'chapters', 'chapterMap']),
    `${operation} navigation`,
  );
  requireMatchingRevisionId(navigation, revision, `${operation} navigation`);
  if (
    navigation.pageCount !== summary.knownExtent.pageCount ||
    navigation.spreadCount !== summary.knownExtent.spreadCount ||
    !Array.isArray(navigation.spreads) ||
    !Array.isArray(navigation.chapters) ||
    !isRecord(navigation.chapterMap)
  ) {
    throw new Error(`${operation} returned malformed presentation navigation`);
  }
  if (navigation.spreads.length !== summary.knownExtent.spreadCount) {
    throw new Error(`${operation} returned incomplete presentation spreads`);
  }
  requirePresentationSpreads(navigation.spreads, summary.knownExtent.pageCount, operation);
  const chapterMap = requirePresentationChapterMap(
    navigation.chapterMap,
    summary.knownExtent.pageCount,
    operation,
  );
  requirePresentationChapters(navigation.chapters, chapterMap, operation);
  return navigation;
}

function requirePresentationSpreads(spreads, pageCount, operation) {
  const pages = new Set();
  for (const [index, spreadValue] of spreads.entries()) {
    const spread = requireObjectInput(spreadValue, `${operation} spread`);
    requireExactFields(
      spread,
      new Set(['spreadIndex', 'pageIndexes', 'leftPageIndex', 'rightPageIndex']),
      `${operation} spread`,
    );
    if (spread.spreadIndex !== index || !Array.isArray(spread.pageIndexes)) {
      throw new Error(`${operation} returned malformed presentation spread ${String(index)}`);
    }
    const expectedLength = spread.rightPageIndex === undefined ? 1 : 2;
    if (
      spread.pageIndexes.length !== expectedLength ||
      spread.pageIndexes[0] !== spread.leftPageIndex ||
      (expectedLength === 2 && spread.pageIndexes[1] !== spread.rightPageIndex)
    ) {
      throw new Error(`${operation} returned inconsistent presentation spread ${String(index)}`);
    }
    for (const pageIndex of spread.pageIndexes) {
      if (!isSafeCount(pageIndex) || pageIndex >= pageCount || pages.has(pageIndex)) {
        throw new Error(`${operation} returned invalid presentation spread page`);
      }
      pages.add(pageIndex);
    }
  }
  if (pages.size !== pageCount) {
    throw new Error(`${operation} returned incomplete presentation page ownership`);
  }
}

function requirePresentationChapterMap(value, pageCount, operation) {
  const ranges = new Map();
  for (const [idref, rangeValue] of Object.entries(value)) {
    if (idref.length === 0) throw new Error(`${operation} returned an empty chapter idref`);
    const range = requireObjectInput(rangeValue, `${operation} chapter range`);
    requireExactFields(
      range,
      new Set(['startPage', 'endPage', 'pageCount', 'blockCount']),
      `${operation} chapter range`,
    );
    if (
      !isSafeCount(range.startPage) ||
      !isSafeCount(range.endPage) ||
      !isSafeCount(range.pageCount) ||
      !isSafeCount(range.blockCount) ||
      range.startPage > range.endPage ||
      range.endPage >= pageCount ||
      range.pageCount !== range.endPage - range.startPage + 1
    ) {
      throw new Error(`${operation} returned an invalid presentation chapter range`);
    }
    ranges.set(idref, range);
  }
  return ranges;
}

function requirePresentationChapters(chapters, chapterMap, operation) {
  const seen = new Set();
  for (const chapterValue of chapters) {
    const chapter = requireObjectInput(chapterValue, `${operation} chapter`);
    requireExactFields(
      chapter,
      new Set(['idref', 'href', 'linear', 'startPage', 'endPage', 'pageCount']),
      `${operation} chapter`,
    );
    if (
      typeof chapter.idref !== 'string' ||
      chapter.idref.length === 0 ||
      seen.has(chapter.idref) ||
      typeof chapter.href !== 'string' ||
      chapter.href.length === 0 ||
      typeof chapter.linear !== 'boolean'
    ) {
      throw new Error(`${operation} returned malformed presentation chapter`);
    }
    seen.add(chapter.idref);
    const present = [chapter.startPage, chapter.endPage, chapter.pageCount].filter(
      (part) => part !== undefined,
    ).length;
    const range = chapterMap.get(chapter.idref);
    if (present === 0) {
      if (range !== undefined) {
        throw new Error(`${operation} omitted a known presentation chapter range`);
      }
    } else if (
      present !== 3 ||
      range === undefined ||
      chapter.startPage !== range.startPage ||
      chapter.endPage !== range.endPage ||
      chapter.pageCount !== range.pageCount
    ) {
      throw new Error(`${operation} returned an inconsistent presentation chapter range`);
    }
  }
  for (const idref of chapterMap.keys()) {
    if (!seen.has(idref)) throw new Error(`${operation} returned an unknown chapter map idref`);
  }
}

function requireTocEntry(value, operation, depth) {
  if (depth > 256) throw new Error(`${operation} returned an excessively deep TOC entry`);
  const entry = requireObjectInput(value, `${operation} TOC entry`);
  requireExactFields(entry, new Set(['label', 'href', 'children']), `${operation} TOC entry`);
  if (
    typeof entry.label !== 'string' ||
    typeof entry.href !== 'string' ||
    entry.href.length === 0 ||
    !Array.isArray(entry.children)
  ) {
    throw new Error(`${operation} returned a malformed TOC entry`);
  }
  for (const child of entry.children) requireTocEntry(child, operation, depth + 1);
}

function requireMatchingRevisionId(value, revision, operation) {
  const record = requireObjectInput(value, operation);
  if (record.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function requireExactFields(value, allowed, operation) {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowed.has(field)) {
      throw new Error(`${operation} returned an unexpected field: ${String(field)}`);
    }
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
