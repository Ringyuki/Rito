import '../protocol/revision_layout.dart';

/// One window of a scrolled book on the device grid, along the scroll axis.
final class RitoScrollWindow {
  const RitoScrollWindow({
    required this.spreadIndex,
    required this.start,
    required this.length,
  });

  final int spreadIndex;

  /// Device pixels from the book's block start to the window's.
  final int start;

  /// Its device pixels along the axis.
  final int length;
}

/// A scrolled book's windows end to end on the device grid.
///
/// Within a chapter window `k` starts `D(k) = floor(k·L·ratio + 0.5)`
/// device pixels in, the rule the engine paints its windows by, and the
/// chapter ends at `floor(extent·ratio + 0.5)`; chapters follow one another
/// end to end. Offsets run from the book's block start: down the screen,
/// or leftwards from the right edge for a book that scrolls leftwards.
final class RitoScrollWindows {
  RitoScrollWindows._(this.axis, this.ratio, this.windows, this.extent);

  /// The windows of [layout], a full one [windowLength] logical pixels
  /// long, at [ratio] device pixels a logical one. Null for a revision of
  /// pages.
  static RitoScrollWindows? of(
    RitoRevisionLayout layout, {
    required double windowLength,
    required double ratio,
  }) {
    final axis = layout.scrollAxis;
    if (axis == null) return null;
    final spreadOfPage = <int, int>{
      for (var index = 0; index < layout.spreads.length; index += 1)
        layout.spreads[index].leftPageIndex: index,
    };
    final windows = <RitoScrollWindow>[];
    var chapterStart = 0;
    for (final chapter in layout.chapters) {
      final extent = chapter.extent;
      final first = spreadOfPage[chapter.startPage];
      if (extent == null || first == null) continue;
      final count = chapter.endPage - chapter.startPage + 1;
      final end = (extent * ratio + 0.5).floor();
      int row(int k) =>
          k >= count ? end : (k * windowLength * ratio + 0.5).floor();
      for (var k = 0; k < count; k += 1) {
        windows.add(
          RitoScrollWindow(
            spreadIndex: first + k,
            start: chapterStart + row(k),
            length: row(k + 1) - row(k),
          ),
        );
      }
      chapterStart += end;
    }
    return RitoScrollWindows._(axis, ratio, windows, chapterStart);
  }

  final RitoScrollAxis axis;
  final double ratio;

  /// Every window, in reading order.
  final List<RitoScrollWindow> windows;

  /// The whole book's device pixels along the axis.
  final int extent;

  /// The window holding device offset [offset]; the nearest end one outside
  /// the book.
  RitoScrollWindow? windowAt(double offset) {
    if (windows.isEmpty) return null;
    var low = 0;
    var high = windows.length - 1;
    while (low < high) {
      final middle = (low + high + 1) >> 1;
      if (windows[middle].start <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return windows[low];
  }
}
