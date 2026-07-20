import 'dart:async';

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
    final image = current.resolveImage(href);

    expect(identical(image, next.resolveImage(href)), isTrue);
    expect(reads, 1);
    expect(decoder.decodedCodes, <int>[7]);
    current.release();
    expect(image.debugDisposed, isFalse);
    next.release();
    expect(image.debugDisposed, isTrue);
    cache.dispose();
  });

  test('partial preparation failure rolls back every acquired image', () async {
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

    await expectLater(
      cache.prepare(
        artifact: artifact,
        pixelRatio: 1,
        readResource: (reference) async => imageResource(
          artifact: artifact,
          reference: reference,
          spec: reference.href.endsWith('one.png') ? firstSpec : failedSpec,
        ),
      ),
      throwsA(isA<StateError>()),
    );

    expect(decoder.createdImages, hasLength(1));
    expect(decoder.createdImages.single.debugDisposed, isTrue);
    expect(decoder.disposedSources, 2);
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
    final image = lease.resolveImage(href);

    lease.release();
    lease.release();
    expect(image.debugDisposed, isTrue);
    expect(() => lease.resolveImage(href), throwsStateError);
    cache.dispose();
    cache.dispose();
  });
}
