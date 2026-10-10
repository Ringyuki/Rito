import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/fake_page_source.dart';

const _next = RitoAdjacentDirection.next;
const _previous = RitoAdjacentDirection.previous;

typedef _Rig = ({
  FakePageSource source,
  RitoReaderController reader,
  RitoPageTurnController turns,
  List<String> events,
});

_Rig _rig(WidgetTester tester, {FakePageSource? source}) {
  final pages = source ?? FakePageSource();
  final reader = RitoReaderController.withSource(pages, layout: fakeLayout);
  final turns = RitoPageTurnController(
    reader: reader,
    vsync: tester,
    paintPage: (canvas, size, page) {},
  )..width = 400;
  final events = <String>[];
  final subscription = turns.events.listen(
    (event) => events.add(switch (event) {
      RitoPageTurnStarted(:final direction) => 'start:${direction.name}',
      RitoPageTurnEnded(:final direction, :final outcome) =>
        'end:${direction.name}:${outcome.name}',
    }),
  );
  addTearDown(() async {
    await subscription.cancel();
    turns.dispose();
    reader.dispose();
  });
  return (source: pages, reader: reader, turns: turns, events: events);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 120; i++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
}

void main() {
  // The outcomes the web reader reports for the same scenarios: both
  // suites read the kit's fixtures/turn-lifecycle.json.
  group('how a turn ends, as on every host', () {
    final table =
        (jsonDecode(
                  File(
                    '../kit/tests/fixtures/turn-lifecycle.json',
                  ).readAsStringSync(),
                )
                as Map<String, Object?>)['ends']!
            as Map<String, Object?>;
    void run(String name, Future<void> Function(WidgetTester, _Rig) drive) {
      testWidgets(name, (tester) async {
        final rig = _rig(tester);
        await tester.pump();
        await drive(tester, rig);
        await _settle(tester);
        final ends = [
          for (final event in rig.events)
            if (event.startsWith('end:')) event.split(':').last,
        ];
        expect(ends, table[name]);
        expect(
          rig.events.where((event) => event.startsWith('start:')).length,
          ends.length,
        );
      });
    }

    run('turn-lands', (tester, rig) async {
      rig.turns.turn(_next);
    });
    run('drag-goes-back', (tester, rig) async {
      rig.turns
        ..dragStart()
        ..dragUpdate(-20)
        ..dragCancel();
    });
    run('turn-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      rig.turns.turn(_next);
    });
    run('jump-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      await rig.reader.jumpTo(const RitoLocator(href: 'b.xhtml'));
    });
    run('jump-during-drag', (tester, rig) async {
      rig.turns
        ..dragStart()
        ..dragUpdate(-30);
      await rig.reader.jumpTo(const RitoLocator(href: 'b.xhtml'));
    });
    run('relayout-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      await rig.reader.relayout(fakeLayout);
    });
  });

  testWidgets('a tap turn lands on the reader and ends committed', (
    tester,
  ) async {
    final rig = _rig(tester);
    final first = rig.reader.page;
    await tester.pump();

    expect(rig.turns.turn(_next), isTrue);
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:committed']);
    expect(rig.reader.page, isNot(same(first)));
    expect(rig.turns.isTurning, isFalse);
    expect(
      rig.turns.textures.page(RitoPageSlot.current),
      same(rig.reader.page),
    );
  });

  testWidgets('a short drag goes back and leaves the reader alone', (
    tester,
  ) async {
    final rig = _rig(tester);
    rig.turns
      ..dragStart()
      ..dragUpdate(-20)
      ..dragEnd(0);
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:cancelled']);
    expect(rig.source.turns, isEmpty);
  });

  testWidgets('a pull against the last page stretches and goes back', (
    tester,
  ) async {
    final rig = _rig(tester, source: FakePageSource(firstNextAvailability: 2));
    rig.turns
      ..dragStart()
      ..dragUpdate(-300);
    expect(rig.turns.frame.incoming, isNull);
    expect(rig.turns.frame.offset, greaterThan(-300));
    rig.turns.dragEnd(-3000);
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:cancelled']);
    expect(rig.source.turns, isEmpty);
    expect(rig.turns.turn(_next), isFalse);
  });

  testWidgets('a turn waits at the neighbour until the reader lands it', (
    tester,
  ) async {
    final rig = _rig(tester);
    final gate = rig.source.turnGate = Completer<void>();
    rig.turns.turn(_next);
    await _settle(tester);
    expect(rig.turns.isTurning, isTrue);
    expect(rig.turns.frame.offset, -400);

    gate.complete();
    await _settle(tester);
    expect(rig.events, ['start:next', 'end:next:committed']);
  });

  testWidgets('a turn the reader cannot land springs back, cancelled', (
    tester,
  ) async {
    final errors = <FlutterErrorDetails>[];
    final previous = FlutterError.onError;
    FlutterError.onError = errors.add;
    addTearDown(() => FlutterError.onError = previous);
    final rig = _rig(tester);
    rig.source.failTurn = true;
    rig.turns.turn(_next);
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:cancelled']);
    expect(rig.turns.frame.offset, 0);
    expect(errors.single.library, 'rito_flutter');
  });

  testWidgets('a tap during a landing turn follows it', (tester) async {
    final rig = _rig(tester);
    final gate = rig.source.turnGate = Completer<void>();
    rig.turns.turn(_next);
    await tester.pump(const Duration(milliseconds: 16));
    rig.turns.turn(_next);
    gate.complete();
    rig.source.turnGate = null;
    await _settle(tester);

    expect(rig.events, [
      'start:next',
      'end:next:committed',
      'start:next',
      'end:next:committed',
    ]);
    expect(rig.source.turns, ['next', 'next']);
  });

  testWidgets('a jump during a turn ends it interrupted', (tester) async {
    final rig = _rig(tester);
    rig.turns
      ..dragStart()
      ..dragUpdate(30);
    await rig.reader.jumpTo(const RitoLocator(href: 'b.xhtml'));
    await tester.pump();

    expect(rig.events, ['start:previous', 'end:previous:interrupted']);
    expect(rig.turns.isTurning, isFalse);
  });

  testWidgets('an animated jump plays as a turn onto the new page', (
    tester,
  ) async {
    final rig = _rig(tester);
    final page = await rig.turns.jumpTo(
      const RitoLocator(href: 'b.xhtml'),
      animateAs: _previous,
    );
    expect(rig.turns.textures.page(RitoPageSlot.previous), same(page));
    await _settle(tester);

    expect(rig.events, ['start:previous', 'end:previous:committed']);
    expect(rig.reader.page, same(page));
    expect(rig.turns.textures.page(RitoPageSlot.current), same(page));
  });

  testWidgets('pagination is held while a turn is on screen', (tester) async {
    final source = FakePageSource(paginationSteps: 3);
    final rig = _rig(tester, source: source);
    rig.turns
      ..dragStart()
      ..dragUpdate(-30);
    final before = source.paginations;
    await tester.pump(const Duration(milliseconds: 50));
    expect(source.paginations, before);

    rig.turns.dragEnd(0);
    await _settle(tester);
    expect(rig.reader.paginationComplete, isTrue);
  });

  testWidgets('reduced motion cross-fades whatever the effect', (tester) async {
    final rig = _rig(tester);
    rig.turns.effect = RitoPageTurnEffects.cover;
    expect(rig.turns.effectiveEffect, same(RitoPageTurnEffects.cover));
    rig.turns.reduceMotion = true;
    expect(rig.turns.effectiveEffect, same(RitoPageTurnEffects.fade));
  });

  testWidgets('the view paints the effect during a turn and the page at rest', (
    tester,
  ) async {
    final rig = _rig(tester);
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: SizedBox(
            width: 400,
            height: 600,
            child: RitoPageTurnView(
              controller: rig.turns,
              child: const Text('live page'),
            ),
          ),
        ),
      ),
    );
    expect(find.text('live page').hitTestable(), findsOneWidget);

    await tester.drag(find.byType(RitoPageTurnView), const Offset(-200, 0));
    await tester.pump();
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:committed']);
    expect(find.text('live page').hitTestable(), findsOneWidget);
  });
}
