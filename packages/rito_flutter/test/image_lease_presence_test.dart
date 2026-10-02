import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/image_cache_fixture.dart';

// Every timer here is the test binding's fake clock: `tester.pump(d)` moves
// time by exactly `d`, so the one-second placeholder, the fade and the
// retry backoff are checked at their edges without real waiting.
void main() {
  const href = 'images/plate.png';
  const spec = TestImageSpec(code: 1, width: 40, height: 40);

  RitoArtifact artifact() => imageArtifact(
    artifactId: 7101,
    hrefs: const <String>[href],
    commands: <RitoPrimitive>[directImage(href)],
  );

  testWidgets('an image shows nothing for a second, then its loading '
      'placeholder, and fades in when it lands late', (tester) async {
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
    await tester.pump(const Duration(milliseconds: 999));
    expect(lease.fallbackState(href), isNull, reason: 'under a second');
    expect(notified, 0);
    await tester.pump(const Duration(milliseconds: 1));
    expect(lease.fallbackState(href), RitoImageFallbackState.loading);
    expect(notified, 1, reason: 'the placeholder repaints');

    arrive.complete();
    await tester.pump();
    await lease.settled;
    expect(lease.resolveImage(href), isNotNull);
    expect(lease.fallbackState(href), RitoImageFallbackState.loading);
    expect(lease.imageOpacity(href), 0);
    await tester.pump(const Duration(milliseconds: 80));
    expect(lease.imageOpacity(href), inExclusiveRange(0, 1));
    await tester.pump(const Duration(milliseconds: 100));
    expect(lease.imageOpacity(href), 1);
    expect(lease.fallbackState(href), isNull);
    lease.release();
    cache.dispose();
  });

  testWidgets('an image that lands in time paints at once without a fade', (
    tester,
  ) async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async =>
          imageResource(artifact: value, reference: reference, spec: spec),
    );
    await tester.pump();
    await lease.settled;
    expect(lease.fallbackState(href), isNull);
    expect(lease.imageOpacity(href), 1);
    await tester.pump(const Duration(seconds: 2));
    expect(lease.fallbackState(href), isNull, reason: 'no late placeholder');
    lease.release();
    cache.dispose();
  });

  testWidgets('a failure that can pass paints broken and is read again after '
      '2s, 5s and 15s while a page listens; a final one stays broken', (
    tester,
  ) async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final reports = <FlutterErrorDetails>[];
    final priorOnError = FlutterError.onError;
    FlutterError.onError = reports.add;
    var reads = 0;
    final lease = await cache.prepare(
      artifact: value,
      readResource: (reference) async {
        reads += 1;
        if (reads <= 3) {
          throw const RitoTransientResourceFailure('offline');
        }
        return imageResource(artifact: value, reference: reference, spec: spec);
      },
    );
    lease.addListener(() {});
    await tester.pump();
    await lease.settled;
    expect(lease.fallbackState(href), RitoImageFallbackState.broken);
    expect(reports, hasLength(1));
    await tester.pump(const Duration(milliseconds: 1999));
    expect(reads, 1);
    await tester.pump(const Duration(milliseconds: 1));
    expect(reads, 2, reason: 'read again after 2s');
    await tester.pump(const Duration(milliseconds: 4999));
    expect(reads, 2);
    await tester.pump(const Duration(milliseconds: 1));
    expect(reads, 3, reason: 'then after 5s');
    await tester.pump(const Duration(milliseconds: 14999));
    expect(reads, 3);
    await tester.pump(const Duration(milliseconds: 1));
    expect(reads, 4, reason: 'then after 15s');
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
    await tester.pump();
    await broken.settled;
    await tester.pump(const Duration(minutes: 1));
    expect(finalReads, 1);
    expect(broken.fallbackState(href), RitoImageFallbackState.broken);
    broken.release();
    cache.dispose();
    FlutterError.onError = priorOnError;
  });

  testWidgets('a failure that can pass waits for a page to listen again', (
    tester,
  ) async {
    final value = artifact();
    final cache = RitoArtifactImageCache(
      decoder: TestImageDecoder(const <TestImageSpec>[spec]),
    );
    final priorOnError = FlutterError.onError;
    FlutterError.onError = (_) {};
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
    await tester.pump();
    await lease.settled;
    await tester.pump(const Duration(minutes: 1));
    expect(reads, 1, reason: 'no page listens');
    lease.addListener(() {});
    await tester.pump();
    expect(reads, 2, reason: 'a page showing it reads it at once');
    lease.release();
    cache.dispose();
    FlutterError.onError = priorOnError;
  });
}
