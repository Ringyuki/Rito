import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

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
  RitoPagePainter? paintPage,
  bool prewarm = true,
}) {
  final pages = source ?? FakePageSource();
  final reader = RitoReaderController.withSource(pages, layout: fakeLayout);
  final turns = RitoPageTurnController(
    reader: reader,
    vsync: tester,
    physics: physics,
    paintPage: paintPage ?? (canvas, size, page) {},
    prewarm: prewarm,
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
/// An effect that brings the vertical physics, and says when it is warmed.
final class _PhysicalEffect extends RitoLayeredPageTurnEffect {
  final warmed = <RitoPageTurnPages>[];

  @override
  RitoPageTurnPhysics get physics => const _VerticalPhysics();

  @override
  void warm(RitoPageTurnPages pages) => warmed.add(pages);

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) =>
      RitoPageTurnEffects.slide.layers(frame);
}

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

/// The built-in physics, keeping the release it was last asked about.
final class _RecordingPhysics extends RitoPageTurnPhysics {
  RitoPageTurnRelease? released;

  @override
  bool lands(RitoPageTurnRelease release) {
    released = release;
    return super.lands(release);
  }
}

/// Owns a reader and its turns as an application does.
final class _TurnOwner extends StatefulWidget {
  const _TurnOwner(this.source);

  final FakePageSource source;

  @override
  State<_TurnOwner> createState() => _TurnOwnerState();
}

final class _TurnOwnerState extends State<_TurnOwner>
    with TickerProviderStateMixin {
  late final RitoReaderController _reader = RitoReaderController.withSource(
    widget.source,
    layout: fakeLayout,
  );
  late final RitoPageTurnController _turns = RitoPageTurnController(
    reader: _reader,
    vsync: this,
    paintPage: (canvas, size, page) {},
  );

  @override
  void initState() {
    super.initState();
    _turns.width = 400;
  }

  @override
  void dispose() {
    _turns.dispose();
    _reader.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SizedBox();
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
    run('turn-back-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      rig.turns.turn(_previous);
    });
    // A finger takes the page a turn is carrying, and flicks it on.
    run('finger-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      rig.turns
        ..dragStart(const Offset(300, 0))
        ..dragUpdate(const Offset(240, 0))
        ..dragEnd(const Offset(-900, 0));
    });
    // A finger that comes down and lifts without moving leaves the turn be.
    run('finger-rests-during-turn', (tester, rig) async {
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      rig.turns
        ..dragStart(const Offset(300, 0))
        ..dragEnd(Offset.zero);
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
    await _settle(tester);
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

  testWidgets('the finger says where it carried the turn farthest', (
    tester,
  ) async {
    final physics = _RecordingPhysics();
    final rig = _rig(tester, physics: physics);
    rig.turns
      ..dragStart(const Offset(300, 500))
      ..dragUpdate(const Offset(200, 480))
      ..dragUpdate(const Offset(120, 470))
      ..dragUpdate(const Offset(160, 460));
    final touch = rig.turns.frame.touch!;
    expect(touch.position, const Offset(160, 460));
    expect(touch.farthest, const Offset(120, 470));

    // The physics judging the release, and the frames after it, see it too.
    rig.turns.dragEnd(Offset.zero);
    expect(physics.released!.touch!.farthest, const Offset(120, 470));
    await tester.pump(const Duration(milliseconds: 16));
    expect(rig.turns.frame.touch!.farthest, const Offset(120, 470));
    await _settle(tester);

    // Turning back, farthest is farthest right; a new drag starts afresh.
    rig.turns
      ..dragStart(const Offset(100, 0))
      ..dragUpdate(const Offset(180, 0))
      ..dragUpdate(const Offset(140, 0));
    expect(rig.turns.direction, _previous);
    expect(rig.turns.frame.touch!.farthest, const Offset(180, 0));
    rig.turns.dragCancel();
    await _settle(tester);
  });

  group('pages are numbered', () {
    const previous = RitoPageSlot.previous;
    const current = RitoPageSlot.current;
    const next = RitoPageSlot.next;
    List<int?> numbers(_Rig rig) => [
      for (final slot in const [previous, current, next])
        rig.turns.textures.spread(slot),
    ];

    testWidgets('in reading order, and keep their numbers across turns', (
      tester,
    ) async {
      final rig = _rig(tester);
      await _settle(tester);
      expect(numbers(rig), [-1, 0, 1]);
      final incoming = rig.turns.textures.page(next);

      rig.turns.turn(_next);
      await _settle(tester);
      expect(rig.turns.textures.page(current), same(incoming));
      expect(numbers(rig), [0, 1, 2]);

      rig.turns.turn(_previous);
      await _settle(tester);
      expect(numbers(rig), [-1, 0, 1]);

      // A turn cut into leaves the page it left beside the one it landed
      // on, with its number.
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 48));
      final left = rig.turns.textures.page(current);
      rig.turns.turn(_next);
      await tester.pump();
      await tester.pump();
      expect(rig.events.last, 'start:next');
      expect(rig.turns.textures.page(previous), same(left));
      expect(numbers(rig), [0, 1, 2]);
      await _settle(tester);
      expect(numbers(rig), [1, 2, 3]);
    });

    testWidgets('apart from every page before after a jump or a relayout', (
      tester,
    ) async {
      final rig = _rig(tester);
      final seen = <int>{};
      void see() => seen.addAll(numbers(rig).whereType<int>());
      await _settle(tester);
      rig.turns.turn(_next);
      await _settle(tester);
      see();

      await rig.reader.jumpTo(const RitoLocator(href: 'b.xhtml'));
      await _settle(tester);
      final jumped = numbers(rig);
      expect(jumped.whereType<int>().where(seen.contains), isEmpty);
      expect([jumped[0]! + 1, jumped[2]! - 1], [jumped[1], jumped[1]]);
      see();

      await rig.reader.relayout(fakeLayout);
      await _settle(tester);
      expect(numbers(rig).whereType<int>().where(seen.contains), isEmpty);
      see();

      // A jump played as a turn comes in past every page on its side.
      await rig.turns.jumpTo(
        const RitoLocator(href: 'c.xhtml'),
        animateAs: _next,
      );
      final forward = rig.turns.textures.spread(next)!;
      expect(forward, greaterThan(seen.reduce(math.max)));
      await _settle(tester);
      expect(rig.turns.textures.spread(current), forward);
      see();

      await rig.turns.jumpTo(
        const RitoLocator(href: 'd.xhtml'),
        animateAs: _previous,
      );
      expect(
        rig.turns.textures.spread(previous),
        lessThan(seen.reduce(math.min)),
      );
      await _settle(tester);
    });

    testWidgets('and a page background pagination renumbers keeps its own', (
      tester,
    ) async {
      final rig = _rig(tester, source: FakePageSource(paginationSteps: 2));
      final before = rig.turns.textures.page(current);
      await _settle(tester);
      expect(rig.reader.lastChange, RitoPageChange.pagination);
      expect(rig.turns.textures.page(current), isNot(same(before)));
      expect(numbers(rig), [-1, 0, 1]);
    });
  });

  group('prewarm', () {
    _Rig painting(WidgetTester tester, List<int> painted, {bool on = true}) =>
        _rig(
          tester,
          prewarm: on,
          paintPage: (canvas, size, page) => painted.add(page.artifactId),
        );

    testWidgets('draws the page and both neighbours before a turn', (
      tester,
    ) async {
      final painted = <int>[];
      final rig = painting(tester, painted);
      await _settle(tester);
      final textures = rig.turns.textures;
      expect(painted.toSet(), {
        for (final slot in RitoPageSlot.values) textures.page(slot)!.artifactId,
      });
      expect(painted, hasLength(3));

      // The first frame of a turn has nothing left to draw.
      painted.clear();
      rig.turns.turn(_next);
      for (final slot in RitoPageSlot.values) {
        textures.image(slot);
      }
      expect(painted, isEmpty);
      await _settle(tester);
    });

    testWidgets('draws a neighbour laid out late once it arrives', (
      tester,
    ) async {
      final source = FakePageSource()..peekGate = Completer<void>();
      final painted = <int>[];
      final rig = _rig(
        tester,
        source: source,
        paintPage: (canvas, size, page) => painted.add(page.artifactId),
      );
      await _settle(tester);
      expect(painted, [rig.reader.page.artifactId]);

      source.peekGate!.complete();
      await _settle(tester);
      expect(painted, hasLength(3));
    });

    testWidgets('draws pages again when they change, once nothing moves', (
      tester,
    ) async {
      final painted = <int>[];
      final rig = painting(tester, painted);
      await _settle(tester);
      painted.clear();
      rig.turns.invalidatePages();
      await _settle(tester);
      expect(painted, hasLength(3));

      painted.clear();
      rig.turns
        ..dragStart(Offset.zero)
        ..dragUpdate(const Offset(-30, 0))
        ..invalidatePages();
      await _settle(tester, frames: 10);
      expect(painted, isEmpty);

      rig.turns.dragCancel();
      await _settle(tester);
      expect(painted, hasLength(3));
    });

    // The test ends with pages still to draw: the widget that owns the
    // controller disposes it with the tree, before the test's timers are
    // checked.
    testWidgets('leaves no timer behind once its owner is gone', (
      tester,
    ) async {
      await tester.pumpWidget(_TurnOwner(FakePageSource()));
    });

    testWidgets('off, draws nothing at rest', (tester) async {
      final painted = <int>[];
      painting(tester, painted, on: false);
      await _settle(tester);
      expect(painted, isEmpty);
    });
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

  group('a turn cut into', () {
    const both = [
      'start:next',
      'end:next:committed',
      'start:next',
      'end:next:committed',
    ];

    /// A turn to the next page, some of the way there, landed by the reader.
    Future<RitoPageTurnFrame> inFlight(WidgetTester tester, _Rig rig) async {
      rig.turns.turn(_next);
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      return rig.turns.frame;
    }

    testWidgets('by a second turn carries its page on, as fast', (
      tester,
    ) async {
      final rig = _rig(tester);
      final before = await inFlight(tester, rig);
      expect(before.offset, lessThan(0));

      rig.turns.turn(_next);

      // The first turn is over, landed where it stood; the second is its
      // picture still moving, the page it left beside it.
      expect(rig.turns.direction, _next);
      final after = rig.turns.frame;
      expect(after.offset, closeTo(before.offset + 400, 1e-6));
      expect(after.velocity, closeTo(before.velocity, 1e-6));
      expect(after.incoming, RitoPageSlot.previous);
      expect(after.phase, RitoPageTurnPhase.returning);
      expect(rig.turns.textures.page(RitoPageSlot.previous), isNotNull);

      var last = after.offset;
      var crossed = false;
      for (var i = 0; i < 120 && rig.turns.isTurning; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        if (!rig.turns.isTurning) break;
        final frame = rig.turns.frame;
        // One motion: the page never moves back on itself.
        expect(frame.offset, lessThanOrEqualTo(last));
        last = frame.offset;
        crossed = crossed || frame.offset <= 0;
        expect(
          frame.incoming,
          crossed ? RitoPageSlot.next : RitoPageSlot.previous,
        );
      }
      await _settle(tester);
      expect(rig.events, both);
      expect(rig.source.turns, ['next', 'next']);
    });

    testWidgets('by a turn back turns the same page round', (tester) async {
      final rig = _rig(tester);
      final before = await inFlight(tester, rig);

      rig.turns.turn(_previous);

      expect(rig.turns.direction, _previous);
      final after = rig.turns.frame;
      expect(after.offset, closeTo(before.offset + 400, 1e-6));
      expect(after.velocity, closeTo(before.velocity, 1e-6));
      expect(after.incoming, RitoPageSlot.previous);
      expect(after.phase, RitoPageTurnPhase.landing);
      for (var i = 0; i < 120 && rig.turns.isTurning; i++) {
        await tester.pump(const Duration(milliseconds: 16));
        if (!rig.turns.isTurning) break;
        // The page never leaves the stretch between the two pages.
        expect(rig.turns.frame.offset, inInclusiveRange(0, 400));
      }
      await _settle(tester);
      expect(rig.events, [
        'start:next',
        'end:next:committed',
        'start:previous',
        'end:previous:committed',
      ]);
      expect(rig.source.turns, ['next', 'previous']);
    });

    testWidgets('by a finger hands it the page where it is', (tester) async {
      final rig = _rig(tester);
      final before = await inFlight(tester, rig);

      rig.turns.dragStart(const Offset(300, 0));
      // The turn is over; its picture is not, and no turn is open yet.
      expect(rig.turns.isTurning, isFalse);
      expect(rig.turns.isMoving, isTrue);
      expect(rig.turns.frame.offset, closeTo(before.offset + 400, 1e-6));

      rig.turns.dragUpdate(const Offset(270, 0));
      expect(rig.turns.direction, _next);
      final held = rig.turns.frame;
      // What was left of the first turn, and the finger's 30 px on top of it.
      expect(held.offset, closeTo(before.offset + 400 - 30, 1e-6));
      expect(held.phase, RitoPageTurnPhase.held);
      expect(held.incoming, RitoPageSlot.previous);

      // A flick on: still short of its own start, and two pages on all the
      // same.
      rig.turns.dragEnd(const Offset(-900, 0));
      await _settle(tester);
      expect(rig.events, both);
      expect(rig.source.turns, ['next', 'next']);
    });

    testWidgets('by a finger that then does nothing comes to rest by itself', (
      tester,
    ) async {
      final rig = _rig(tester);
      await inFlight(tester, rig);

      rig.turns
        ..dragStart(const Offset(300, 0))
        ..dragEnd(Offset.zero);
      expect(rig.turns.isMoving, isTrue);
      await _settle(tester);

      expect(rig.turns.isMoving, isFalse);
      expect(rig.turns.frame.offset, 0);
      expect(rig.events, ['start:next', 'end:next:committed']);
      expect(rig.source.turns, ['next']);
    });

    testWidgets('before the reader has landed it keeps moving and waits', (
      tester,
    ) async {
      final rig = _rig(tester);
      final gate = rig.source.turnGate = Completer<void>();
      rig.turns.turn(_next);
      await tester.pump(const Duration(milliseconds: 16));
      final before = rig.turns.frame.offset;

      rig.turns.turn(_next);
      // Nothing is settled before the reader has the page; the turn goes on.
      await tester.pump(const Duration(milliseconds: 16));
      expect(rig.events, ['start:next']);
      expect(rig.source.turns, ['next']);
      expect(rig.turns.frame.offset, lessThan(before));

      gate.complete();
      rig.source.turnGate = null;
      await tester.pump(const Duration(milliseconds: 16));
      // Landed where it stood: the page it left is still in the frame.
      expect(rig.source.turns, ['next', 'next']);
      expect(rig.turns.frame.offset, greaterThan(0));
      await _settle(tester);
      expect(rig.events, both);
    });
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

  testWidgets('an effect that brings physics moves the turn by them', (
    tester,
  ) async {
    final rig = _rig(tester);
    rig.turns.effect = _PhysicalEffect();
    // A sideways drag is no travel to the effect's physics: no turn begins.
    rig.turns
      ..dragStart(const Offset(200, 500))
      ..dragUpdate(const Offset(60, 500));
    expect(rig.turns.isTurning, isFalse);
    rig.turns.dragUpdate(const Offset(60, 380));
    expect(rig.turns.frame.offset, -120);
    rig.turns.dragCancel();
    // Back to an effect without physics: the controller's own again.
    rig.turns.effect = RitoPageTurnEffects.slide;
    await _settle(tester);
    rig.turns
      ..dragStart(const Offset(200, 500))
      ..dragUpdate(const Offset(60, 500));
    expect(rig.turns.frame.offset, -140);
    rig.turns.dragCancel();
    await _settle(tester);
  });

  testWidgets(
    'warms the effect once the pages beside the one shown are painted',
    (tester) async {
      final rig = _rig(tester);
      final effect = _PhysicalEffect();
      rig.turns.effect = effect;
      await _settle(tester, frames: 10);
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await _settle(tester, frames: 10);
      expect(effect.warmed, isNotEmpty);
      expect(effect.warmed.last.image(RitoPageSlot.current), isNotNull);
    },
  );

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
    await _settle(tester);
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
