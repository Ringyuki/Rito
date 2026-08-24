import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_native.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';
import 'support/image_cache_fixture.dart';

Future<ui.Image> solidImage(int width, int height) async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawRect(
    ui.Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    ui.Paint()..color = const ui.Color(0xff2266aa),
  );
  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  picture.dispose();
  return image;
}

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

  testWidgets('a test artifact paints a page that draws images', (
    tester,
  ) async {
    const href = 'images/plate.png';
    final artifact = imageArtifact(
      artifactId: 8001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href, width: 40, height: 40)],
    );
    final image = await solidImage(8, 8);
    addTearDown(image.dispose);
    final prepared = RitoPreparedArtifact.forTest(
      artifact,
      images: <String, ui.Image>{href: image},
    );

    expect(prepared.hasPreparedImages, isTrue);
    expect(prepared.resolveImage(href), same(image));
    expect(() => prepared.resolveImage('images/missing.png'), throwsStateError);

    // The point of the constructor: a widget test with no session
    // anywhere can put a page with image commands on screen.
    var resolved = 0;
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: RitoPageSurface(
          artifact: prepared,
          resolveImage: (candidate) {
            resolved += 1;
            return prepared.resolveImage(candidate);
          },
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(resolved, greaterThan(0), reason: 'the image command painted');
  });

  test('a superseded artifact is told apart from a wrong one', () {
    // Both used to be ArgumentError with the same message, so a host
    // could not tell "reissue this" from "you passed the wrong thing".
    const stale = RitoArtifactNotLiveException(sessionId: 7, artifactId: 9);
    expect(stale, isNot(isA<ArgumentError>()));
    expect(stale.toString(), contains('no longer live'));
    expect(stale.artifactId, 9);
  });
}
