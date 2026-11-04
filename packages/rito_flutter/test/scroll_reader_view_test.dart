import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const RitoLayoutRequest _layout = RitoLayoutRequest(
  viewportWidth: 420,
  viewportHeight: 640,
  marginTop: 24,
  marginRight: 24,
  marginBottom: 24,
  marginLeft: 24,
  spreadMode: RitoSpreadMode.scrolled,
  firstPageAlone: false,
  spreadGap: 0,
  rootFontSize: 16,
);

Future<RitoReaderSession> _open(int sessionId) => RitoReaderSession.open(
  gateway: RitoNativeGateway(),
  publicationBytes: File(
    '../rito/tests/fixtures/books/book-10.epub',
  ).readAsBytesSync(),
  request: RitoArtifactRequest(
    sessionId: sessionId,
    requestId: 1,
    layout: _layout,
    locator: const RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
  ),
  pinnedFontPolicy: RitoPinnedFontPolicy(
    faces: <RitoPinnedFontFace>[
      RitoPinnedFontFace(
        bytes: File(
          '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
        ).readAsBytesSync(),
        genericRole: RitoPinnedFontGenericRole.serif,
      ),
    ],
  ),
);

Future<void> _settle(WidgetTester tester) async {
  for (var turn = 0; turn < 20; turn += 1) {
    await tester.pump();
  }
}

void main() {
  testWidgets('a scrolled chapter reads on as its windows scroll by', (
    tester,
  ) async {
    final session = await _open(9951);
    final controller = RitoScrollReaderController(
      session,
      layout: _layout,
      devicePixelRatio: 1,
      layOutBook: false,
    );
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(420, 640);
    addTearDown(tester.view.reset);
    final taps = <RitoScrollTap>[];
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: RitoScrollReaderView(controller: controller, onTap: taps.add),
      ),
    );
    await _settle(tester);
    final windows = controller.windows;
    expect(windows, isNotNull);
    expect(windows!.axis, RitoScrollAxis.down);
    expect(windows.windows.length, greaterThan(2));
    expect(controller.readingSpread, 0);
    expect(
      controller.windowArtifact(1),
      isNotNull,
      reason: 'the next window loads',
    );

    // Past the reading line of the second window: it becomes the page read.
    await tester.drag(find.byType(RitoScrollReaderView), const Offset(0, -700));
    await _settle(tester);
    expect(controller.readingSpread, 1);
    expect(controller.visible.artifact.localSpreadIndex, 1);
    expect(session.visibleArtifactId, controller.visible.artifactId);

    // At rest, the reader reads the line at the reading line of that window.
    final position = controller.position.value;
    expect(position, isNotNull);
    expect(position!.href, 'OEBPS/Text/Section013.xhtml');
    expect(position.sourcePoint, isNotNull);

    // A tap says which window it fell in and where.
    await tester.tapAt(const Offset(200, 300));
    await _settle(tester);
    expect(taps, hasLength(1));
    expect(taps.single.spreadIndex, 1);
    expect(taps.single.point.dx, 200);

    controller.dispose();
    await _settle(tester);
    await session.dispose();
  });

  testWidgets(
    'an app selects across a seam through the view and draws it over each window',
    (tester) async {
      final session = await _open(9952);
      final controller = RitoScrollReaderController(
        session,
        layout: _layout,
        devicePixelRatio: 1,
        layOutBook: false,
      );
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(420, 640);
      addTearDown(tester.view.reset);
      final key = GlobalKey<RitoScrollReaderViewState>();
      final overlaid = <int>{};
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: RitoScrollReaderView(
            key: key,
            controller: controller,
            windowOverlay: (context, window) {
              overlaid.add(window.spreadIndex);
              return const SizedBox.expand();
            },
          ),
        ),
      );
      await _settle(tester);
      // The seam between the first two windows 240 px down the view.
      await tester.drag(
        find.byType(RitoScrollReaderView),
        const Offset(0, -400),
      );
      await _settle(tester);
      expect(overlaid, containsAll(<int>[0, 1]));
      final view = key.currentState!;
      final from = view.pointAt(const Offset(100, 100))!;
      final to = view.pointAt(const Offset(200, 400))!;
      expect(from.spreadIndex, 0);
      expect(from.point, const Offset(100, 500));
      expect(to.spreadIndex, 1);
      expect(to.point, const Offset(200, 160));

      RitoTextPoint at(RitoScrollPoint point) => RitoTextPoint(
        pageIndex: point.pageIndex,
        x: point.point.dx,
        y: point.point.dy,
      );
      final caret = await session.textInteraction(
        controller.visible,
        RitoCaretQuery(at(from)),
        everyPage: true,
      );
      final anchor = (caret as RitoCaretResult).caret;
      expect(anchor.writingMode, RitoWritingMode.horizontalTb);
      expect(anchor.geometry!.width, 0);
      final range = await session.textInteraction(
        controller.visible,
        RitoRangeToPointQuery(anchor: anchor.address, focus: at(to)),
        everyPage: true,
      );
      final rects = (range as RitoSelectionResult).selection.rects;
      // Each window's rects are in its own display list, where its overlay is.
      expect(rects.map((rect) => rect.pageIndex).toSet(), <int>{
        from.pageIndex,
        to.pageIndex,
      });
      final second = rects.where((rect) => rect.pageIndex == to.pageIndex);
      expect(second.first.bounds.y, lessThan(to.point.dy));

      controller.dispose();
      await _settle(tester);
      await session.dispose();
    },
  );
}
