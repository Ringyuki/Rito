import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/fake_page_source.dart';

const _next = RitoAdjacentDirection.next;
const _previous = RitoAdjacentDirection.previous;

void main() {
  test('a turn lands on the peeked neighbour and releases the rest', () async {
    final source = FakePageSource();
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);
    final first = reader.page;

    final next = await reader.neighbour(_next);
    final previous = await reader.neighbour(_previous);
    expect(await reader.neighbour(_next), same(next));
    expect(source.peeks, 2);

    final changes = <int>[];
    reader.addListener(() => changes.add(reader.revision));
    expect(await reader.turn(_next), same(next));
    await pumpEventQueue();

    expect(reader.page, same(next));
    expect(changes, <int>[1]);
    expect(
      source.released,
      unorderedEquals(<int>[first.artifactId, previous!.artifactId]),
    );
  });

  test('a peek queued behind a turn is skipped, not leaked', () async {
    final source = FakePageSource();
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);

    final turned = reader.turn(_next);
    final stale = reader.neighbour(_previous);
    await turned;
    expect(await stale, isNull);
    expect(source.peeks, 0);
    // The page changed, so asking again peeks from the new page.
    expect(await reader.neighbour(_previous), isNotNull);
  });

  test('the ends of the book have no neighbour and no turn', () async {
    final source = FakePageSource(firstNextAvailability: 2);
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);

    expect(reader.canTurn(_next), isFalse);
    expect(await reader.neighbour(_next), isNull);
    expect(await reader.turn(_next), isNull);
    expect(source.peeks, 0);
  });

  test('a later jump supersedes one that has not run yet', () async {
    final source = FakePageSource();
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);
    const a = RitoLocator(href: 'a.xhtml');
    const b = RitoLocator(href: 'b.xhtml');

    final blocker = reader.withPage((_) => source.gate.future);
    final first = reader.jumpTo(a);
    final second = reader.jumpTo(b);
    source.gate.complete();
    await blocker;

    expect(await first, isNull);
    expect((await second)?.artifact.locator.href, 'b.xhtml');
    expect(source.seeks, <String>['b.xhtml']);
  });

  test('pagination adopts the renumbered page and pauses while held', () async {
    final source = FakePageSource(paginationSteps: 2);
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);
    final release = reader.holdPagination();
    await pumpEventQueue();
    expect(source.paginations, 0);

    release();
    await pumpEventQueue();
    expect(source.paginations, 2);
    expect(reader.paginationComplete, isTrue);
    expect(reader.revision, 1);
  });

  test('a pagination failure is reported and stops pagination', () async {
    final errors = <FlutterErrorDetails>[];
    final previous = FlutterError.onError;
    FlutterError.onError = errors.add;
    addTearDown(() => FlutterError.onError = previous);
    final source = FakePageSource(failPagination: true);
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    addTearDown(reader.dispose);

    await pumpEventQueue();
    expect(errors.single.library, 'rito_flutter');
    expect(reader.paginationComplete, isTrue);
    expect(reader.page, same(source.firstPage));
  });

  test('disposing releases the peeked neighbours', () async {
    final source = FakePageSource();
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    final next = await reader.neighbour(_next);
    reader.dispose();
    await pumpEventQueue();
    expect(source.released, <int>[next!.artifactId]);
  });
}
