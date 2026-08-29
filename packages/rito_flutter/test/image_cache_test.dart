import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('prepares twelve images with at most four concurrent reads', () async {
    final hrefs = List<String>.generate(12, (index) => 'images/$index.png');
    final specs = List<TestImageSpec>.generate(
      12,
      (index) => TestImageSpec(code: index + 1, width: 100, height: 100),
    );
    final byHref = <String, TestImageSpec>{
      for (var index = 0; index < hrefs.length; index += 1)
        hrefs[index]: specs[index],
    };
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: hrefs,
      commands: hrefs.map(directImage).toList(growable: false),
    );
    final decoder = TestImageDecoder(specs);
    final cache = RitoArtifactImageCache(decoder: decoder);
    var active = 0;
    var peak = 0;

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async {
        active += 1;
        peak = active > peak ? active : peak;
        await Future<void>.delayed(Duration.zero);
        active -= 1;
        return imageResource(
          artifact: artifact,
          reference: reference,
          spec: byHref[reference.href]!,
        );
      },
    );

    expect(peak, 4);
    expect(decoder.decodedCodes, hasLength(12));
    lease.release();
    cache.dispose();
  });

  test('overlapping leases share one cache-wide four-work limit', () async {
    final firstHrefs = List<String>.generate(6, (index) => 'images/a$index.png');
    final secondHrefs = List<String>.generate(
      6,
      (index) => 'images/b$index.png',
    );
    final hrefs = <String>[...firstHrefs, ...secondHrefs];
    final specs = List<TestImageSpec>.generate(
      hrefs.length,
      (index) => TestImageSpec(code: index + 1, width: 32, height: 32),
    );
    final byHref = <String, TestImageSpec>{
      for (var index = 0; index < hrefs.length; index += 1)
        hrefs[index]: specs[index],
    };
    final first = imageArtifact(
      artifactId: 7001,
      hrefs: firstHrefs,
      commands: firstHrefs.map(directImage).toList(growable: false),
    );
    final second = imageArtifact(
      artifactId: 7002,
      requestId: 13,
      hrefs: secondHrefs,
      commands: secondHrefs.map(directImage).toList(growable: false),
    );
    final cache = RitoArtifactImageCache(decoder: TestImageDecoder(specs));
    var active = 0;
    var peak = 0;

    Future<RitoArtifactImageLease> prepare(RitoArtifact artifact) {
      return cache.prepare(
        artifact: artifact,
        pixelRatio: 1,
        readResource: (reference) async {
          active += 1;
          peak = active > peak ? active : peak;
          await Future<void>.delayed(Duration.zero);
          active -= 1;
          return imageResource(
            artifact: artifact,
            reference: reference,
            spec: byHref[reference.href]!,
          );
        },
      );
    }

    final leases = await Future.wait<RitoArtifactImageLease>(
      <Future<RitoArtifactImageLease>>[prepare(first), prepare(second)],
    );

    expect(peak, 4);
    for (final lease in leases) {
      lease.release();
    }
    cache.dispose();
  });

  test('cache disposal rejects queued work and stops active read before decode', () async {
    const firstSpec = TestImageSpec(code: 1, width: 20, height: 20);
    const secondSpec = TestImageSpec(code: 2, width: 20, height: 20);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>['images/active.png', 'images/queued.png'],
      commands: <RitoCommand>[
        directImage('images/active.png'),
        directImage('images/queued.png'),
      ],
    );
    final decoder = TestImageDecoder(
      const <TestImageSpec>[firstSpec, secondSpec],
    );
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      maxConcurrentDecodes: 1,
    );
    final started = Completer<void>();
    final unblock = Completer<void>();
    final preparation = cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async {
        final active = reference.href.endsWith('active.png');
        if (active) {
          started.complete();
          await unblock.future;
        }
        return imageResource(
          artifact: artifact,
          reference: reference,
          spec: active ? firstSpec : secondSpec,
        );
      },
    );
    final failure = expectLater(preparation, throwsStateError);

    await started.future;
    cache.dispose();
    unblock.complete();
    await failure;

    expect(decoder.openedCodes, isEmpty);
    expect(decoder.createdImages, isEmpty);
  });

  test('current and incoming animation artifacts share one decode', () async {
    const href = 'images/shared.png';
    const spec = TestImageSpec(code: 7, width: 400, height: 200);
    final first = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href, width: 80, height: 40)],
    );
    final incoming = imageArtifact(
      artifactId: 7002,
      requestId: 13,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href, width: 80, height: 40)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);
    var reads = 0;

    Future<RitoResource> reader(
      RitoArtifact artifact,
      RitoResourceRef reference,
    ) async {
      reads += 1;
      return imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      );
    }

    final current = await cache.prepare(
      artifact: first,
      pixelRatio: 1,
      readResource: (reference) => reader(first, reference),
    );
    final next = await cache.prepare(
      artifact: incoming,
      pixelRatio: 1,
      readResource: (reference) => reader(incoming, reference),
    );
    final image = current.resolveImage(href)!;

    expect(identical(image, next.resolveImage(href)), isTrue);
    expect(reads, 1);
    expect(decoder.decodedCodes, <int>[7]);
    current.release();
    expect(image.debugDisposed, isFalse);
    next.release();
    expect(image.debugDisposed, isTrue);
    cache.dispose();
  });

  test('a failing image degrades to recorded absence, not a blocked page', () async {
    // One broken plate must never take down the whole artifact: the
    // page still turns, the healthy image paints, the fault is reported
    // through FlutterError and recorded on the lease.
    const firstSpec = TestImageSpec(code: 1, width: 40, height: 40);
    const failedSpec = TestImageSpec(
      code: 2,
      width: 40,
      height: 40,
      failDecode: true,
    );
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>['images/one.png', 'images/two.png'],
      commands: <RitoCommand>[
        directImage('images/one.png'),
        directImage('images/two.png'),
      ],
    );
    final decoder = TestImageDecoder(
      const <TestImageSpec>[firstSpec, failedSpec],
    );
    final cache = RitoArtifactImageCache(
      decoder: decoder,
      maxConcurrentDecodes: 1,
    );

    final reports = <FlutterErrorDetails>[];
    final priorOnError = FlutterError.onError;
    FlutterError.onError = reports.add;
    final RitoArtifactImageLease lease;
    try {
      lease = await cache.prepare(
        artifact: artifact,
        pixelRatio: 1,
        readResource: (reference) async => imageResource(
          artifact: artifact,
          reference: reference,
          spec: reference.href.endsWith('one.png') ? firstSpec : failedSpec,
        ),
      );
    } finally {
      FlutterError.onError = priorOnError;
    }

    expect(lease.resolveImage('images/one.png'), isNotNull);
    expect(lease.resolveImage('images/two.png'), isNull);
    expect(lease.failedImages.keys, ['images/two.png']);
    expect(reports, hasLength(1));
    expect(decoder.disposedSources, 2);
    lease.release();
    expect(decoder.createdImages.single.debugDisposed, isTrue);
    cache.dispose();
  });

  test('lease release and cache disposal are idempotent and fail closed', () async {
    const href = 'images/owned.png';
    const spec = TestImageSpec(code: 9, width: 32, height: 32);
    final artifact = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);
    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async => imageResource(
        artifact: artifact,
        reference: reference,
        spec: spec,
      ),
    );
    final image = lease.resolveImage(href)!;

    lease.release();
    lease.release();
    expect(image.debugDisposed, isTrue);
    expect(() => lease.resolveImage(href), throwsStateError);
    cache.dispose();
    cache.dispose();
  });
  test('one-pixel codec rounding on a full-size decode is tolerated', () async {
    // The 402x183 reality: the engine's scaled-decode entry floors the
    // derived axis and returns 402x182 for a same-size target.
    const spec = TestImageSpec(
      code: 41,
      width: 402,
      height: 183,
      decodedWidth: 402,
      decodedHeight: 182,
      misdecodeFullSize: true,
    );
    final artifact = imageArtifact(
      artifactId: 7301,
      hrefs: const ['images/plate.png'],
      commands: [directImage('images/plate.png', width: 402, height: 183)],
    );
    final decoder = TestImageDecoder(const [spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async =>
          imageResource(artifact: artifact, reference: reference, spec: spec),
    );

    expect(decoder.decodedCodes, hasLength(1));
    expect(lease.resolveImage('images/plate.png')!.height, 182);
    lease.release();
    cache.dispose();
  });

  test('a decode that breaks its target falls back to a full-size decode', () async {
    // Scaled decode returns nonsense; the fallback full-size decode is
    // exact, so the artifact survives with the source-sized image.
    const spec = TestImageSpec(
      code: 42,
      width: 800,
      height: 600,
      decodedWidth: 100,
      decodedHeight: 50,
    );
    final artifact = imageArtifact(
      artifactId: 7302,
      hrefs: const ['images/broken-scale.png'],
      commands: [
        directImage('images/broken-scale.png', width: 400, height: 300),
      ],
    );
    final decoder = TestImageDecoder(const [spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);

    final lease = await cache.prepare(
      artifact: artifact,
      pixelRatio: 1,
      readResource: (reference) async =>
          imageResource(artifact: artifact, reference: reference, spec: spec),
    );

    expect(decoder.decodedCodes, hasLength(2), reason: 'fallback re-decodes');
    final image = lease.resolveImage('images/broken-scale.png')!;
    expect((image.width, image.height), (800, 600));
    lease.release();
    cache.dispose();
  });

  test('an image that cannot reproduce itself is recorded with full numbers', () async {
    const spec = TestImageSpec(
      code: 43,
      width: 402,
      height: 183,
      decodedWidth: 50,
      decodedHeight: 50,
      misdecodeFullSize: true,
    );
    final artifact = imageArtifact(
      artifactId: 7303,
      hrefs: const ['images/broken.png'],
      commands: [directImage('images/broken.png', width: 402, height: 183)],
    );
    final decoder = TestImageDecoder(const [spec]);
    final cache = RitoArtifactImageCache(decoder: decoder);

    final reports = <FlutterErrorDetails>[];
    final priorOnError = FlutterError.onError;
    FlutterError.onError = reports.add;
    final RitoArtifactImageLease lease;
    try {
      lease = await cache.prepare(
        artifact: artifact,
        pixelRatio: 1,
        readResource: (reference) async =>
            imageResource(artifact: artifact, reference: reference, spec: spec),
      );
    } finally {
      FlutterError.onError = priorOnError;
    }
    expect(decoder.decodedCodes, hasLength(2));
    expect(lease.resolveImage('images/broken.png'), isNull);
    expect(
      lease.failedImages['images/broken.png'],
      isA<FormatException>().having(
        (error) => error.message,
        'message',
        allOf(contains('decoded=50x50'), contains('source=402x183')),
      ),
    );
    expect(reports, hasLength(1));
    lease.release();
    cache.dispose();
  });
}
