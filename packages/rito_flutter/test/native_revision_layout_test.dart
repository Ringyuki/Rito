import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

RitoArtifactRequest _request(int sessionId) => RitoArtifactRequest(
  sessionId: sessionId,
  requestId: 1,
  layout: const RitoLayoutRequest(
    viewportWidth: 420,
    viewportHeight: 640,
    marginTop: 24,
    marginRight: 24,
    marginBottom: 24,
    marginLeft: 24,
    spreadMode: RitoSpreadMode.single,
    firstPageAlone: true,
    spreadGap: 0,
    rootFontSize: 16,
  ),
  locator: const RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
);

Future<RitoReaderSession> _open(int sessionId) => RitoReaderSession.open(
  gateway: RitoNativeGateway(),
  publicationBytes: File(
    '../rito/tests/fixtures/books/book-10.epub',
  ).readAsBytesSync(),
  request: _request(sessionId),
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

void main() {
  test('a page reaches any spread its revision lays out', () async {
    final session = await _open(9401);
    try {
      final first = session.firstArtifact;
      final layout = await session.revisionLayout(first);
      // The first page is laid out with its chapter alone.
      expect(layout.chapters, hasLength(1));
      expect(layout.chapters.single.startPage, 0);
      expect(layout.chapters.single.endPage, layout.pageCount - 1);
      expect(layout.spreads, hasLength(layout.pageCount));
      expect(layout.activeTocEntryByPage, hasLength(layout.pageCount));
      expect(layout.spreads.length, greaterThan(2));

      final last = layout.spreads.length - 1;
      final target = await session.peekSpread(
        from: first,
        requestId: session.nextRequestId,
        spreadIndex: last,
      );
      expect(target.artifact.localSpreadIndex, last);
      expect(target.artifact.localPageIndexes, <int>[
        layout.spreads[last].leftPageIndex,
      ]);
      expect(session.visibleArtifactId, first.artifactId);

      await expectLater(
        session.peekSpread(
          from: first,
          requestId: session.nextRequestId,
          spreadIndex: layout.spreads.length,
        ),
        throwsA(isA<RitoNativeException>()),
      );
      await expectLater(
        session.commitSpread(from: first, spread: first),
        throwsStateError,
      );

      final shown = await session.commitSpread(from: first, spread: target);
      expect(shown.artifactId, target.artifactId);
      expect(session.visibleArtifactId, target.artifactId);
      await expectLater(
        session.commitSpread(from: first, spread: target),
        throwsStateError,
      );

      // The committed spread turns like any other page.
      final previous = await session.turn(
        from: target,
        requestId: session.nextRequestId,
        direction: RitoAdjacentDirection.previous,
      );
      expect(previous.artifact.localSpreadIndex, last - 1);
    } finally {
      await session.dispose();
    }
  });
}
