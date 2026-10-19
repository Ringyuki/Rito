import 'binary_reader.dart';

/// The page table of one revision.
///
/// A chapter-local revision lays out one chapter and counts its pages
/// from zero; a whole-book revision lays out every chapter and its pages
/// are book pages. A spread is addressed by its position in [spreads].
final class RitoRevisionLayout {
  const RitoRevisionLayout({
    required this.pageCount,
    required this.spreads,
    required this.chapters,
    required this.tocTargets,
    required this.activeTocEntryByPage,
    required this.complete,
  });

  final int pageCount;

  /// Every spread's pages, in reading order.
  final List<RitoSpreadPages> spreads;

  /// The chapters the revision lays out, in spine order.
  final List<RitoChapterPages> chapters;

  /// The TOC entries the revision places on a page, in TOC order.
  final List<RitoTocTargetPage> tocTargets;

  /// Per page, the `tocId` of the entry it reads under: the last entry
  /// whose target sits at or before it.
  final List<int?> activeTocEntryByPage;

  /// Whether the table holds every page of its chapters. One that does
  /// not holds their first pages, numbered and spread as all of them are;
  /// a TOC entry whose target lies past them is not placed yet.
  final bool complete;
}

final class RitoSpreadPages {
  const RitoSpreadPages({required this.leftPageIndex, this.rightPageIndex});

  final int leftPageIndex;
  final int? rightPageIndex;
}

/// The pages one spine item is laid out on, both ends included.
final class RitoChapterPages {
  const RitoChapterPages({
    required this.spineIndex,
    required this.startPage,
    required this.endPage,
  });

  /// The item's index in the publication's spine.
  final int spineIndex;
  final int startPage;
  final int endPage;
}

final class RitoTocTargetPage {
  const RitoTocTargetPage({required this.tocId, required this.pageIndex});

  /// The entry's preorder index — the `tocId` the publication carries.
  final int tocId;
  final int pageIndex;
}

/// Reads the layout a RITONVR1 message carries after its result tag.
RitoRevisionLayout readRitoRevisionLayout(RitoBinaryReader reader) {
  int? optional(String field) =>
      reader.option(field, () => reader.uint32(field));
  List<T> collection<T>(String field, T Function() read) => <T>[
    for (var count = reader.count(field); count > 0; count -= 1) read(),
  ];
  return RitoRevisionLayout(
    pageCount: reader.uint32('layout page count'),
    spreads: collection(
      'layout spreads',
      () => RitoSpreadPages(
        leftPageIndex: reader.uint32('spread left page'),
        rightPageIndex: optional('spread right page'),
      ),
    ),
    chapters: collection(
      'layout chapters',
      () => RitoChapterPages(
        spineIndex: reader.uint32('chapter spine index'),
        startPage: reader.uint32('chapter start page'),
        endPage: reader.uint32('chapter end page'),
      ),
    ),
    tocTargets: collection(
      'layout toc targets',
      () => RitoTocTargetPage(
        tocId: reader.uint32('toc target entry'),
        pageIndex: reader.uint32('toc target page'),
      ),
    ),
    activeTocEntryByPage: collection(
      'layout page toc entries',
      () => optional('page toc entry'),
    ),
    complete: reader.boolean('layout complete'),
  );
}
