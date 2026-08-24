export function createRitoCoreWasmReaderManifestHrefMap(publication) {
  return new Map(publication.package.manifest.map((item) => [item.id, item.href]));
}

export function createRitoCoreWasmReaderPages(pageCount, config) {
  return Array.from({ length: pageCount }, (_, index) => ({
    index,
    bounds: { x: 0, y: 0, width: config.pageWidth, height: config.pageHeight },
    content: [],
  }));
}

export function createRitoCoreWasmReaderSpreads(pages, navigation) {
  return navigation.spreads.map((spread) => {
    const left = pageForNavigation(pages, spread.leftPageIndex, spread.spreadIndex, 'left');
    const right =
      spread.rightPageIndex === undefined
        ? undefined
        : pageForNavigation(pages, spread.rightPageIndex, spread.spreadIndex, 'right');
    return right === undefined
      ? { index: spread.spreadIndex, left }
      : { index: spread.spreadIndex, left, right };
  });
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
  return spreads.find(
    (spread) => spread.left?.index === pageIndex || spread.right?.index === pageIndex,
  )?.index;
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

function pageForNavigation(pages, pageIndex, spreadIndex, side) {
  const page = pages[pageIndex];
  if (!page) {
    throw new Error(
      `Rito reader navigation references missing ${side} page ${pageIndex} for spread ${spreadIndex}`,
    );
  }
  return page;
}
