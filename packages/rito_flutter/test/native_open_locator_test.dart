import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _layout = RitoLayoutRequest(
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
);

Future<RitoReaderSession> _open(int sessionId, RitoLocator locator) =>
    RitoReaderSession.open(
      gateway: RitoNativeGateway(),
      publicationBytes: File(
        '../rito/tests/fixtures/books/book-10.epub',
      ).readAsBytesSync(),
      request: RitoArtifactRequest(
        sessionId: sessionId,
        requestId: 1,
        layout: _layout,
        locator: locator,
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

void main() {
  test(
    'a saved position whose chapter the book does not hold opens the book at its start, and says so',
    () async {
      final start = await _open(9501, const RitoLocator(href: ''));
      final session = await _open(
        9502,
        const RitoLocator(href: 'OEBPS/Text/Gone.xhtml', progression: 0.5),
      );
      try {
        final opened = session.firstArtifact.artifact;
        expect(opened.matchedBy, RitoLocatorMatch.bookStart);
        expect(opened.locator.href, start.firstArtifact.artifact.locator.href);
        expect(opened.localPageIndex, 0);

        // Once open, such a locator fails and the reader keeps its page.
        await expectLater(
          session.requestArtifact(
            RitoArtifactRequest(
              sessionId: session.sessionId,
              requestId: session.nextRequestId,
              layout: _layout,
              locator: const RitoLocator(href: 'OEBPS/Text/Gone.xhtml'),
            ),
          ),
          throwsA(isA<RitoNativeException>()),
        );
        expect(session.visibleArtifactId, opened.artifactId);
      } finally {
        await session.dispose();
        await start.dispose();
      }
    },
  );
}
