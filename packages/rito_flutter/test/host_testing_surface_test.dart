import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_native.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('hosts can build a prepared artifact without a session', () {
    final artifact = const RitoArtifactDecoder().decode(artifactFixture());
    final prepared = RitoPreparedArtifact.forTest(artifact);

    expect(prepared.artifactId, artifact.artifactId);
    expect(prepared.sessionId, artifact.sessionId);
    expect(prepared.fonts, artifact.fonts);
    // Nothing was prepared, so image resolution must fail loudly rather
    // than hand back a surface that paints blanks.
    expect(prepared.hasPreparedImages, isFalse);
    expect(() => prepared.resolveImage('images/x.png'), throwsStateError);
  });

  test('layout overrides reach the engine and change pagination', () {
    final publication = File(
      '../rito/tests/fixtures/books/book-10.epub',
    ).readAsBytesSync();
    const work = RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 32,
      maxForegroundQuanta: 64,
      localPageCap: 16,
    );
    RitoArtifact open(int sessionId, {double? lineHeight, String? family}) {
      final bindings = RitoNativeBindings();
      try {
        return bindings.openEncoded(
          publicationBytes: publication,
          requestBytes: const RitoRequestEncoder().encode(
            RitoArtifactRequest(
              sessionId: sessionId,
              requestId: 1,
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
                lineHeightOverride: lineHeight,
                fontFamilyOverride: family,
              ),
              locator: const RitoLocator(
                href: 'OEBPS/Text/Section013.xhtml',
              ),
              work: work,
            ),
          ),
        );
      } finally {
        bindings.dispose(sessionId: sessionId);
      }
    }

    final baseline = open(9201);
    // A unitless scale: 2.4x line height must fit strictly fewer text
    // runs on the first page than the book's own leading.
    final loose = open(9202, lineHeight: 2.4);
    final baselineRuns = baseline.pages.first.textRuns.length;
    final looseRuns = loose.pages.first.textRuns.length;
    expect(
      looseRuns,
      lessThan(baselineRuns),
      reason: 'lineHeightOverride is a scale and must reflow the page',
    );

    // The family override replaces the book's families, so the paint
    // stack the display list carries changes. Run counts are a weak
    // proxy (without pinned faces every family measures the same), so
    // assert the family string the pen will actually resolve.
    String firstFamily(RitoArtifact artifact) => artifact
        .displayList
        .displayList
        .commands
        .whereType<RitoPaintText>()
        .map((command) => command.paint.font.family)
        .first;

    final overridden = open(9203, family: 'Courier New, monospace');
    expect(
      firstFamily(overridden),
      isNot(firstFamily(baseline)),
      reason: 'fontFamilyOverride must reach the paint stack',
    );
    expect(
      firstFamily(overridden),
      contains('Courier New'),
      reason: 'the override replaces the book family rather than trailing it',
    );
    expect(
      firstFamily(overridden),
      endsWith('monospace'),
      reason: 'the generic tail is what a pinned policy attaches to',
    );
  });
}
