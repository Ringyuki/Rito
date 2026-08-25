import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('uses DPR and the larger stretched axis without full-size decode', () async {
    const href = 'images/wide-target.png';
    const spec = TestImageSpec(code: 1, width: 1000, height: 1000);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[
        directImage(href, width: 400, height: 40),
      ],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      targetBucketSize: 1,
    );

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 2,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );

    expect(decoder.targets[1], (width: 800, height: 800));
    lease.release();
    cache.dispose();
  });

  test('background cover target is collected at its actual tile size', () async {
    const href = 'images/background.png';
    const spec = TestImageSpec(code: 2, width: 4000, height: 2000);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[
        coverBackground(href, width: 200, height: 100),
      ],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      targetBucketSize: 1,
    );

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 2,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );

    expect(decoder.targets[2], (width: 400, height: 200));
    lease.release();
    cache.dispose();
  });

  test('background auto retains source pixels because they define CSS tile size', () async {
    const href = 'images/auto-background.png';
    const spec = TestImageSpec(code: 8, width: 1200, height: 800);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[
        autoBackground(href, width: 200, height: 100),
      ],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      targetBucketSize: 1,
    );

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 0.5,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );

    expect(decoder.targets[8], (width: 1200, height: 800));
    lease.release();
    cache.dispose();
  });

  test('rejects returned resource identity before opening a decoder', () async {
    const href = 'images/identity.png';
    const spec = TestImageSpec(code: 3, width: 100, height: 100);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href)],
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
      commands: <RitoCommand>[
        directImage(href, width: 100, height: 100),
      ],
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
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );

    expect(decoder.decodedCodes, isEmpty);
    expect(decoder.disposedSources, 1);
    expect(lease.resolveImage(href), isNull);
    expect(
      lease.failedImages[href],
      isA<RitoImageBudgetExceededException>(),
    );
    lease.release();
    cache.dispose();
  });

  test('rejects oversized source dimensions before decoding pixels', () async {
    const href = 'images/bomb.png';
    const spec = TestImageSpec(code: 5, width: 20000, height: 2);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href)],
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
      ),
    );

    expect(decoder.decodedCodes, isEmpty);
    expect(decoder.disposedSources, 1);
    expect(lease.resolveImage(href), isNull);
    expect(
      lease.failedImages[href],
      isA<RitoImageBudgetExceededException>(),
    );
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
    lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: readResource,
    );
  } finally {
    FlutterError.onError = priorOnError;
  }
  expect(reports, hasLength(1));
  return lease;
}
