import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';
import 'support/image_cache_fixture.dart';

void main() {
  testWidgets('uses a fixed paint surface inside a repaint boundary', (
    tester,
  ) async {
    final artifact = await _preparedArtifact();
    final resolvedHrefs = <String>[];
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: RitoPageSurface(
          artifact: artifact,
          resolveImage: (href) {
            resolvedHrefs.add(href);
            return null;
          },
        ),
      ),
    );

    expect(find.byType(RepaintBoundary), findsOneWidget);
    final customPaint = tester.widget<CustomPaint>(find.byType(CustomPaint));
    expect(customPaint.size, const Size(360, 640));
    expect(customPaint.isComplex, isTrue);
    expect(customPaint.willChange, isFalse);
    expect(resolvedHrefs, isNotEmpty);
    expect(resolvedHrefs, everyElement('../Images/cover.png'));
  });

  testWidgets('does not repaint when owned artifact identity is unchanged', (
    tester,
  ) async {
    final artifact = await _preparedArtifact();
    Widget surface() => Directionality(
      textDirection: TextDirection.ltr,
      child: RitoPageSurface(artifact: artifact, resolveImage: (_) => null),
    );

    await tester.pumpWidget(surface());
    final first = tester.widget<CustomPaint>(find.byType(CustomPaint)).painter!;
    await tester.pumpWidget(surface());
    final second = tester
        .widget<CustomPaint>(find.byType(CustomPaint))
        .painter!;

    expect(second.shouldRepaint(first), isFalse);
  });

  testWidgets('uses the prepared image lease when no host resolver is given', (
    tester,
  ) async {
    const href = 'images/prepared.png';
    const spec = TestImageSpec(code: 1, width: 40, height: 40);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href)],
    );
    final fonts = await RitoArtifactFontCache(
      registrar: const _NoopFontRegistrar(),
    ).prepare(
      artifact: artifact,
      readResource: (_) => throw StateError('No fonts expected.'),
    );
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final images = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );
    final prepared = RitoPreparedArtifact.withImageLease(
      fontPrepared: fonts,
      imageLease: images,
    );

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: RitoPageSurface(artifact: prepared),
      ),
    );

    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    images.release();
    cache.dispose();
  });
}

Future<RitoPreparedArtifact> _preparedArtifact() {
  final artifact = const RitoArtifactDecoder().decode(artifactFixture());
  return RitoArtifactFontCache(registrar: const _NoopFontRegistrar()).prepare(
    artifact: artifact,
    readResource: (reference) async => RitoResource(
      artifactId: artifact.artifactId,
      kind: RitoResourceKind.font,
      href: reference.href,
      mediaType: 'font/woff2',
      bytes: Uint8List(8192),
    ),
  );
}

final class _NoopFontRegistrar implements RitoFontRegistrar {
  const _NoopFontRegistrar();

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {}
}
