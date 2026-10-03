import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

const _fonts = '../../apps/reader/src/assets/fonts';

RitoPinnedFontFace _face(String file, RitoPinnedFontGenericRole role) =>
    RitoPinnedFontFace(
      bytes: File('$_fonts/$file').readAsBytesSync(),
      genericRole: role,
    );

RitoArtifactRequest _request(
  int sessionId,
  int requestId, {
  String? fontFamilyOverride,
}) => RitoArtifactRequest(
  sessionId: sessionId,
  requestId: requestId,
  layout: RitoLayoutRequest(
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
    fontFamilyOverride: fontFamilyOverride,
  ),
  locator: const RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
);

Set<String> _paintedFamilies(RitoPreparedArtifact page) => <String>{
  for (final command in page.artifact.displayList.displayList.commands)
    if (command is RitoPrimitiveText) command.command.paint.font.family,
};

void main() {
  test(
    'a face added mid-session is nameable and paints the next page',
    () async {
      const sessionId = 9301;
      final tinos = _face('Tinos-Regular.ttf', RitoPinnedFontGenericRole.serif);
      final session = await RitoReaderSession.open(
        gateway: RitoIsolateGateway(),
        publicationBytes: File(
          '../rito/tests/fixtures/books/book-10.epub',
        ).readAsBytesSync(),
        request: _request(sessionId, 1),
        pinnedFontPolicy: RitoPinnedFontPolicy(
          faces: <RitoPinnedFontFace>[tinos],
        ),
      );
      try {
        final catalog = await session.fontCatalog();
        expect(catalog.families.first.name, 'Tinos');
        expect(catalog.families.first.source, RitoFontSource.host);
        expect(
          catalog.families.first.genericRole,
          RitoPinnedFontGenericRole.serif,
        );
        expect(_paintedFamilies(session.firstArtifact), <String>{
          tinos.familyAlias,
        });
        expect(await session.unresolvedFontFamilies('Arimo, serif'), <String>[
          'Arimo',
        ]);

        final arimo = _face(
          'Arimo-Regular.ttf',
          RitoPinnedFontGenericRole.sansSerif,
        );
        await session.addFontFaces(<RitoPinnedFontFace>[arimo]);
        expect(await session.unresolvedFontFamilies('Arimo, serif'), isEmpty);
        final page = await session.requestArtifact(
          _request(
            sessionId,
            session.nextRequestId,
            fontFamilyOverride: 'Arimo',
          ),
        );
        // The Latin runs paint with the added face, by its own alias.
        expect(_paintedFamilies(page), contains(arimo.familyAlias));

        await session.removeFontFaces(<String>[arimo.sha256Hex]);
        expect(await session.unresolvedFontFamilies('Arimo'), <String>[
          'Arimo',
        ]);
      } finally {
        await session.dispose();
      }
    },
  );
}
