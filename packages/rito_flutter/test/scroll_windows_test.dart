import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/protocol/revision_layout.dart';
import 'package:rito_flutter/src/scroll/scroll_windows.dart';

RitoRevisionLayout _layout(RitoScrollAxis axis) => RitoRevisionLayout(
  pageCount: 7,
  spreads: <RitoSpreadPages>[
    for (var page = 0; page < 7; page += 1)
      RitoSpreadPages(leftPageIndex: page),
  ],
  chapters: const <RitoChapterPages>[
    RitoChapterPages(spineIndex: 0, startPage: 0, endPage: 0, extent: 300.5),
    RitoChapterPages(spineIndex: 1, startPage: 1, endPage: 4, extent: 3401.25),
    RitoChapterPages(spineIndex: 2, startPage: 5, endPage: 6, extent: 1900),
  ],
  tocTargets: const <RitoTocTargetPage>[],
  activeTocEntryByPage: List<int?>.filled(7, null),
  complete: true,
  scrollAxis: axis,
);

void main() {
  test('windows tile each chapter by the engine rule, chapters end to end', () {
    for (final ratio in <double>[1, 1.25, 1.5, 2, 2.625, 3]) {
      final windows = RitoScrollWindows.of(
        _layout(RitoScrollAxis.down),
        windowLength: 950,
        ratio: ratio,
      )!;
      final all = windows.windows;
      expect(all.map((window) => window.spreadIndex), <int>[
        0,
        1,
        2,
        3,
        4,
        5,
        6,
      ]);
      for (var index = 1; index < all.length; index += 1) {
        expect(all[index].start, all[index - 1].start + all[index - 1].length);
      }
      expect(all[1].start, (300.5 * ratio + 0.5).floor());
      expect(all[2].start - all[1].start, (950 * ratio + 0.5).floor());
      expect(
        windows.extent,
        (300.5 * ratio + 0.5).floor() +
            (3401.25 * ratio + 0.5).floor() +
            (1900 * ratio + 0.5).floor(),
      );
    }
  });

  test('finds the window under an offset, the end ones outside the book', () {
    final windows = RitoScrollWindows.of(
      _layout(RitoScrollAxis.left),
      windowLength: 950,
      ratio: 1,
    )!;
    expect(windows.axis, RitoScrollAxis.left);
    expect(windows.windowAt(0)?.spreadIndex, 0);
    expect(windows.windowAt(300)?.spreadIndex, 0);
    expect(windows.windowAt(301)?.spreadIndex, 1);
    expect(windows.windowAt(-10)?.spreadIndex, 0);
    expect(windows.windowAt(1e9)?.spreadIndex, 6);
  });

  test('a revision of pages has no windows', () {
    final paged = RitoRevisionLayout(
      pageCount: 1,
      spreads: const <RitoSpreadPages>[RitoSpreadPages(leftPageIndex: 0)],
      chapters: const <RitoChapterPages>[
        RitoChapterPages(spineIndex: 0, startPage: 0, endPage: 0),
      ],
      tocTargets: const <RitoTocTargetPage>[],
      activeTocEntryByPage: const <int?>[null],
      complete: true,
    );
    expect(RitoScrollWindows.of(paged, windowLength: 950, ratio: 1), isNull);
  });
}
