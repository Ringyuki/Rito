export function createRitoCoreWasmReaderManifestHrefMap(publication) {
  return new Map(publication.package.manifest.map((item) => [item.id, item.href]));
}

export function createRitoCoreWasmReaderSpreads(navigation) {
  return navigation.spreads.map((spread) => ({
    index: spread.spreadIndex,
    pageIndexes: spread.pageIndexes,
    leftPageIndex: spread.leftPageIndex,
    ...(spread.rightPageIndex === undefined ? {} : { rightPageIndex: spread.rightPageIndex }),
  }));
}

export function createRitoCoreWasmReaderChapterMap(navigation) {
  const map = new Map();
  for (const [idref, range] of Object.entries(navigation.chapterMap)) {
    map.set(idref, { startPage: range.startPage, endPage: range.endPage });
  }
  return map;
}

export function findRitoCoreWasmReaderTocTarget(targets, entry) {
  return targets.find((target) => target.entry.href === entry.href);
}

export function findRitoCoreWasmReaderActiveTocEntry(targets, pageIndex) {
  let active;
  for (const target of targets) {
    if (target.pageIndex <= pageIndex) active = target;
  }
  return active?.entry;
}

export function findRitoCoreWasmReaderSpreadContainingPage(spreads, pageIndex) {
  return spreads.find((spread) => spread.pageIndexes.includes(pageIndex))?.index;
}

export function createRitoCoreWasmReaderFootnoteMap(footnotes) {
  return new Map(
    Object.entries(footnotes.entries).map(([key, value]) => [
      key,
      { kind: value.kind, text: value.text, html: value.html },
    ]),
  );
}

export function createRitoCoreWasmReaderChapterTextIndexMap(indices) {
  return new Map(
    Object.entries(indices.entries).map(([key, value]) => [
      key,
      {
        href: value.href,
        normalizedText: value.normalizedText,
        spans: value.spans.map((span) => ({
          nodePath: span.nodePath,
          sourceStart: span.sourceStart,
          sourceEnd: span.sourceEnd,
          normalizedStart: span.normalizedStart,
          normalizedEnd: span.normalizedEnd,
        })),
      },
    ]),
  );
}
