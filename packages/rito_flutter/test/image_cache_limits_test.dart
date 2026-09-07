import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'uses the larger stretched axis of the device rect without full-size decode',
    () async {
      // A 400×40 CSS box lowered at ratio 2 is an 800×80 device rect; the
      // aspect-preserving decode follows its wider axis.
      const href = 'images/wide-target.png';
      const spec = TestImageSpec(code: 1, width: 1000, height: 1000);
      final artifact = imageArtifact(
        artifactId: 7001,
        hrefs: const <String>[href],
        commands: <RitoPrimitive>[directImage(href, width: 800, height: 80)],
        ratio: 2,
      );
      final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
      final cache = RitoArtifactImageCache(
        decoder: decoder,
        targetBucketSize: 1,
      );

      final lease = await cache.prepare(
        artifact: artifact,
        readResource: (reference) async =>
            imageResource(artifact: artifact, reference: reference, spec: spec),
      );

      expect(decoder.targets[1], (width: 800, height: 800));
      lease.release();
      cache.dispose();
    },
  );

  test(
    'a covering background decodes at the device rect it lands in',
    () async {
      // A 200×100 CSS box lowered at ratio 2 and covered by a 4000×2000
      // image: the engine sized the draw to 400×200 device pixels.
      const href = 'images/background.png';
      const spec = TestImageSpec(code: 2, width: 4000, height: 2000);
      final artifact = imageArtifact(
        artifactId: 7001,
        hrefs: const <String>[href],
        commands: <RitoPrimitive>[directImage(href, width: 400, height: 200)],
        ratio: 2,
      );
      final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
      final cache = RitoArtifactImageCache(
        decoder: decoder,
        targetBucketSize: 1,
      );

      final lease = await cache.prepare(
        artifact: artifact,
        readResource: (reference) async =>
            imageResource(artifact: artifact, reference: reference, spec: spec),
      );

      expect(decoder.targets[2], (width: 400, height: 200));
      lease.release();
      cache.dispose();
    },
  );

  test('a tiled background decodes at its device tile size', () async {
    // An auto-sized 1200×800 tile lowered at ratio 0.5 is 600×400 device
    // pixels; the tile geometry is the engine's, so the decode follows it.
    const href = 'images/auto-background.png';
    const spec = TestImageSpec(code: 8, width: 1200, height: 800);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoPrimitive>[
        tiledImage(href, tileWidth: 600, tileHeight: 400, columns: 2, rows: 2),
      ],
      ratio: 0.5,
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(decoder: decoder, targetBucketSize: 1);

    final lease = await cache.prepare(
      artifact: artifact,
      readResource: (reference) async =>
          imageResource(artifact: artifact, reference: reference, spec: spec),
    );

    expect(decoder.targets[8], (width: 600, height: 400));
    lease.release();
    cache.dispose();
  });

  test('rejects returned resource identity before opening a decoder', () async {
    const href = 'images/identity.png';
    const spec = TestImageSpec(code: 3, width: 100, height: 100);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoPrimitive>[directImage(href)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);

    final lease = await preparedWithContainedFailure(
      cache: cache,
      artifact: artifact,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
        returnedArtifactId: artifact.artifactId + 1,
      ),
    );

    expect(decoder.openedCodes, isEmpty);
    expect(lease.resolveImage(href), isNull);
    expect(lease.failedImages[href], isA<StateError>());
    lease.release();
    cache.dispose();
  });

  test('rejects lease target budget before decoding pixels', () async {
    const href = 'images/budget.png';
    const spec = TestImageSpec(code: 4, width: 100, height: 100);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoPrimitive>[directImage(href, width: 100, height: 100)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      targetBucketSize: 1,
      limits: const RitoArtifactImageLimits(maxTargetPixelsPerLease: 999),
    );

    final lease = await preparedWithContainedFailure(
      cache: cache,
      artifact: artifact,
      readResource: (reference) async =>
          imageResource(artifact: artifact, reference: reference, spec: spec),
    );

    expect(decoder.decodedCodes, isEmpty);
    expect(decoder.disposedSources, 1);
    expect(lease.resolveImage(href), isNull);
    expect(lease.failedImages[href], isA<RitoImageBudgetExceededException>());
    lease.release();
    cache.dispose();
  });

  test('rejects oversized source dimensions before decoding pixels', () async {
    const href = 'images/bomb.png';
    const spec = TestImageSpec(code: 5, width: 20000, height: 2);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoPrimitive>[directImage(href)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);

    final lease = await preparedWithContainedFailure(
      cache: cache,
      artifact: artifact,
      readResource: (reference) async =>
          imageResource(artifact: artifact, reference: reference, spec: spec),
    );

    expect(decoder.decodedCodes, isEmpty);
    expect(decoder.disposedSources, 1);
    expect(lease.resolveImage(href), isNull);
    expect(lease.failedImages[href], isA<RitoImageBudgetExceededException>());
    lease.release();
    cache.dispose();
  });
}

/// Prepares while capturing the FlutterError report the contained image
/// fault must produce; exactly one report is part of the contract.
Future<RitoArtifactImageLease> preparedWithContainedFailure({
  required RitoArtifactImageCache cache,
  required RitoArtifact artifact,
  required Future<RitoResource> Function(RitoResourceRef reference)
  readResource,
}) async {
  final reports = <FlutterErrorDetails>[];
  final priorOnError = FlutterError.onError;
  FlutterError.onError = reports.add;
  final RitoArtifactImageLease lease;
  try {
    lease = await cache.prepare(artifact: artifact, readResource: readResource);
  } finally {
    FlutterError.onError = priorOnError;
  }
  expect(reports, hasLength(1));
  return lease;
}
