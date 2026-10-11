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

_Rig _rig(
  WidgetTester tester, {
  FakePageSource? source,
  RitoPageTurnPhysics physics = const RitoPageTurnPhysics(),
}) {
  final pages = source ?? FakePageSource();
  final reader = RitoReaderController.withSource(pages, layout: fakeLayout);
  final turns = RitoPageTurnController(
    reader: reader,
    vsync: tester,
    physics: physics,
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

Future<void> _settle(WidgetTester tester, {int frames = 120}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
}

/// Turns pages under a vertical drag, turns on any release past a quarter
/// of the page however the finger was moving, and takes one second to rest.
final class _VerticalPhysics extends RitoPageTurnPhysics {
  const _VerticalPhysics();

  @override
  double travel(Offset origin, Offset position) => position.dy - origin.dy;

  @override
  bool lands(RitoPageTurnRelease release) =>
      release.offset.abs() > release.width / 4;

  @override
  Simulation settle({
    required double from,
    required double velocity,
    required double to,
  }) => _Steady(from, to);
}

/// A second at constant speed.
final class _Steady extends Simulation {
  _Steady(this.from, this.to);

  final double from;
  final double to;

  @override
  double x(double time) => from + (to - from) * time.clamp(0.0, 1.0);

  @override
  double dx(double time) => to - from;

  @override
  bool isDone(double time) => time >= 1;
}

/// An effect that asks to be painted again by itself.
final class _ClockEffect extends RitoPageTurnEffect {
  final ValueNotifier<int> clock = ValueNotifier<int>(0);
  int paints = 0;

  @override
  Listenable get repaint => clock;

  @override
  void paint(RitoPageTurnScene scene, RitoPageTurnFrame frame) => paints += 1;
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
        ..dragStart(Offset.zero)
        ..dragUpdate(const Offset(-20, 0))
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
        ..dragStart(Offset.zero)
        ..dragUpdate(const Offset(-30, 0));
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
      ..dragStart(Offset.zero)
      ..dragUpdate(const Offset(-20, 0))
      ..dragEnd(Offset.zero);
    await _settle(tester);

    expect(rig.events, ['start:next', 'end:next:cancelled']);
    expect(rig.source.turns, isEmpty);
  });

  testWidgets('a pull against the last page stretches and goes back', (
    tester,
  ) async {
    final rig = _rig(tester, source: FakePageSource(firstNextAvailability: 2));
    rig.turns
      ..dragStart(Offset.zero)
      ..dragUpdate(const Offset(-300, 0));
    expect(rig.turns.frame.incoming, isNull);
    expect(rig.turns.frame.offset, greaterThan(-300));
    rig.turns.dragEnd(const Offset(-3000, 0));
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
      ..dragStart(Offset.zero)
      ..dragUpdate(const Offset(30, 0));
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
      ..dragStart(Offset.zero)
      ..dragUpdate(const Offset(-30, 0));
    final before = source.paginations;
    await tester.pump(const Duration(milliseconds: 50));
    expect(source.paginations, before);

    rig.turns.dragEnd(Offset.zero);
    await _settle(tester);
    expect(rig.reader.paginationComplete, isTrue);
  });

  testWidgets('a frame says what moves the turn and where the finger is', (
    tester,
  ) async {
    final rig = _rig(tester);
    rig.turns
      ..dragStart(const Offset(300, 500))
      ..dragUpdate(const Offset(180, 420));
    var frame = rig.turns.frame;
    expect(frame.phase, RitoPageTurnPhase.held);
    expect(frame.offset, -120);
    expect(frame.velocity, 0);
    expect(frame.touch!.origin, const Offset(300, 500));
    expect(frame.touch!.position, const Offset(180, 420));

    rig.turns.dragEnd(const Offset(-900, -200));
    await tester.pump(const Duration(milliseconds: 16));
    frame = rig.turns.frame;
    expect(frame.phase, RitoPageTurnPhase.landing);
    expect(frame.velocity, lessThan(0));
    // The finger is reported where it let go.
    expect(frame.touch!.position, const Offset(180, 420));
    await _settle(tester);

    // A tap: no finger has held the turn.
    rig.turns.turn(_next);
    await tester.pump(const Duration(milliseconds: 16));
    expect(rig.turns.frame.phase, RitoPageTurnPhase.landing);
    expect(rig.turns.frame.touch, isNull);
    await _settle(tester);

    rig.turns
      ..dragStart(Offset.zero)
      ..dragUpdate(const Offset(-20, 0))
      ..dragEnd(Offset.zero);
    await tester.pump(const Duration(milliseconds: 16));
    expect(rig.turns.frame.phase, RitoPageTurnPhase.returning);
    await _settle(tester);
  });

  testWidgets('a drag begun while a turn lands takes hold once it has', (
    tester,
  ) async {
    final rig = _rig(tester);
    final gate = rig.source.turnGate = Completer<void>();
    rig.turns.turn(_next);
    await tester.pump(const Duration(milliseconds: 16));
    rig.turns
      ..dragStart(const Offset(300, 0))
      ..dragUpdate(const Offset(250, 0));
    expect(rig.events, ['start:next']);
    gate.complete();
    rig.source.turnGate = null;
    await _settle(tester);
    expect(rig.events, ['start:next', 'end:next:committed']);

    // The page follows the finger from where it was when the turn landed.
    rig.turns.dragUpdate(const Offset(220, 0));
    expect(rig.turns.direction, _next);
    expect(rig.turns.frame.offset, -30);
    rig.turns.dragCancel();
    await _settle(tester);
    expect(rig.events.sublist(2), ['start:next', 'end:next:cancelled']);
  });

  testWidgets('physics an application writes move the turn', (tester) async {
    final rig = _rig(tester, physics: const _VerticalPhysics());
    // A sideways drag is no travel to these physics: no turn begins.
    rig.turns
      ..dragStart(const Offset(200, 500))
      ..dragUpdate(const Offset(60, 500));
    expect(rig.turns.isTurning, isFalse);

    rig.turns.dragUpdate(const Offset(60, 380));
    expect(rig.turns.frame.incoming, RitoPageSlot.next);
    expect(rig.turns.frame.offset, -120);
    // Let go while pulling back: the built-in rule would send it back.
    rig.turns.dragEnd(const Offset(0, 900));
    expect(rig.turns.frame.phase, RitoPageTurnPhase.landing);

    // Their simulation carries it: constant speed, one second.
    await _settle(tester, frames: 20);
    final early = rig.turns.frame.offset;
    await _settle(tester, frames: 20);
    expect(rig.turns.frame.offset - early, closeTo(-280 * 20 * 0.016, 0.01));
    expect(rig.turns.frame.velocity, -280);
    await _settle(tester, frames: 15);
    expect(rig.turns.isTurning, isTrue);
    await _settle(tester, frames: 15);
    expect(rig.events, ['start:next', 'end:next:committed']);
  });

  testWidgets('an effect on a clock of its own repaints the turn', (
    tester,
  ) async {
    final rig = _rig(tester);
    final effect = _ClockEffect();
    rig.turns.effect = effect;
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Center(
          child: SizedBox(
            width: 400,
            height: 600,
            child: RitoPageTurnView(
              controller: rig.turns,
              child: const SizedBox.expand(),
            ),
          ),
        ),
      ),
    );
    rig.turns
      ..dragStart(const Offset(300, 100))
      ..dragUpdate(const Offset(250, 100));
    // The neighbour that arrived late has faded in; the finger rests and
    // nothing paints the turn again.
    await _settle(tester, frames: 30);
    final held = effect.paints;
    expect(held, greaterThan(0));
    await tester.pump(const Duration(milliseconds: 16));
    expect(effect.paints, held);

    // The effect's own clock moves on.
    effect.clock.value += 1;
    await tester.pump(const Duration(milliseconds: 16));
    expect(effect.paints, held + 1);
    rig.turns.dragCancel();
    await _settle(tester);
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
