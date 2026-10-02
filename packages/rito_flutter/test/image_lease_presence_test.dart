import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const href = 'images/plate.png';
  const spec = TestImageSpec(code: 1, width: 40, height: 40);

  RitoArtifact artifact() => imageArtifact(
    artifactId: 7101,
    hrefs: const <String>[href],
    commands: <RitoPrimitive>[directImage(href)],
  );

  test('an image shows nothing for a second, then its loading placeholder, '
      'and fades in when it lands late', () async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final arrive = Completer<void>();
    var notified = 0;
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async {
        await arrive.future;
        return imageResource(artifact: value, reference: reference, spec: spec);
      },
    );
    lease.addListener(() => notified += 1);

    expect(lease.resolveImage(href), isNull);
    expect(lease.fallbackState(href), isNull);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(lease.fallbackState(href), isNull, reason: 'under a second');
    await Future<void>.delayed(const Duration(milliseconds: 700));
    expect(lease.fallbackState(href), RitoImageFallbackState.loading);
    expect(notified, greaterThan(0), reason: 'the placeholder repaints');

    arrive.complete();
    await lease.settled;
    expect(lease.resolveImage(href), isNotNull);
    expect(lease.fallbackState(href), RitoImageFallbackState.loading);
    expect(lease.imageOpacity(href), lessThan(1));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(lease.imageOpacity(href), 1);
    expect(lease.fallbackState(href), isNull);
    lease.release();
    cache.dispose();
  });

  test('an image that lands in time paints at once without a fade', () async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async =>
          imageResource(artifact: value, reference: reference, spec: spec),
    );
    await lease.settled;
    expect(lease.fallbackState(href), isNull);
    expect(lease.imageOpacity(href), 1);
    lease.release();
    cache.dispose();
  });

  test('a failure that can pass paints broken and is read again after 2s '
      'while a page listens; a final one stays broken', () async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final reports = <FlutterErrorDetails>[];
    final priorOnError = FlutterError.onError;
    FlutterError.onError = reports.add;
    addTearDown(() => FlutterError.onError = priorOnError);
    var reads = 0;
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async {
        reads += 1;
        if (reads == 1) {
          throw const RitoTransientResourceFailure('offline');
        }
        return imageResource(artifact: value, reference: reference, spec: spec);
      },
    );
    lease.addListener(() {});
    await lease.settled;
    expect(lease.fallbackState(href), RitoImageFallbackState.broken);
    expect(reports, hasLength(1));
    await Future<void>.delayed(const Duration(milliseconds: 2300));
    expect(reads, 2);
    expect(lease.resolveImage(href), isNotNull);
    lease.release();

    var finalReads = 0;
    final broken = await cache.prepare(
      artifact: value,
      readResource: (reference) async {
        finalReads += 1;
        throw StateError('not in the publication');
      },
    );
    broken.addListener(() {});
    await broken.settled;
    await Future<void>.delayed(const Duration(milliseconds: 2300));
    expect(finalReads, 1);
    expect(broken.fallbackState(href), RitoImageFallbackState.broken);
    broken.release();
    cache.dispose();
  });

  test('a failure that can pass waits for a page to listen again', () async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final priorOnError = FlutterError.onError;
    FlutterError.onError = (_) {};
    addTearDown(() => FlutterError.onError = priorOnError);
    var reads = 0;
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async {
        reads += 1;
        if (reads == 1) {
          throw const RitoTransientResourceFailure('offline');
        }
        return imageResource(artifact: value, reference: reference, spec: spec);
      },
    );
    await lease.settled;
    await Future<void>.delayed(const Duration(milliseconds: 2300));
    expect(reads, 1, reason: 'no page listens');
    lease.addListener(() {});
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(reads, 2, reason: 'a page showing it reads it at once');
    lease.release();
    cache.dispose();
  });
}
