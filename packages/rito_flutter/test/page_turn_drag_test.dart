import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/src/turn/motion.dart';

import 'support/fake_page_source.dart';

RitoPageTurnController _controller(
  WidgetTester tester, {
  FakePageSource? source,
  bool prewarm = true,
}) {
  final reader = RitoReaderController.withSource(
    source ?? FakePageSource(),
    layout: fakeLayout,
  );
  final turns = RitoPageTurnController(
    reader: reader,
    vsync: tester,
    paintPage: (canvas, size, page) {},
    prewarm: prewarm,
  )..width = 400;
  addTearDown(() {
    turns.dispose();
    reader.dispose();
  });
  return turns;
}

Future<void> _view(WidgetTester tester, RitoPageTurnController turns) =>
    tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: 400,
            height: 600,
            child: RitoPageTurnView(
              controller: turns,
              child: const SizedBox.expand(),
            ),
          ),
        ),
      ),
    );

void main() {
  testWidgets(
    'a finger turns the page once it has moved 5 px either way, from where it came down',
    (tester) async {
      final turns = _controller(tester);
      await _view(tester, turns);
      final finger = await tester.startGesture(const Offset(300, 300));
      await finger.moveTo(const Offset(296, 303));
      expect(turns.isTurning, isFalse);
      await finger.moveTo(const Offset(290, 303));
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, -10);
      expect(turns.frame.touch!.origin, const Offset(300, 300));
      await finger.up();
      await tester.pumpAndSettle();
    },
  );

  testWidgets('a finger sliding up or down the page does not turn it', (
    tester,
  ) async {
    final turns = _controller(tester);
    await _view(tester, turns);
    final finger = await tester.startGesture(const Offset(300, 300));
    await finger.moveTo(const Offset(298, 330));
    await finger.moveTo(const Offset(296, 420));
    expect(turns.isTurning, isFalse);
    await finger.up();
    await tester.pumpAndSettle();
    expect(turns.isTurning, isFalse);
    expect(turns.reader.lastChange, isNot(RitoPageChange.turn));
  });

  testWidgets(
    'a finger sliding up the page and then across turns it from where it went across',
    (tester) async {
      final turns = _controller(tester);
      await _view(tester, turns);
      final finger = await tester.startGesture(const Offset(300, 400));
      await finger.moveTo(const Offset(300, 340));
      expect(turns.isTurning, isFalse);
      await finger.moveTo(const Offset(290, 338));
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, -10);
      expect(turns.frame.touch!.origin, const Offset(300, 340));
      await finger.up();
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'a finger drifting a little across as it slides does not turn it',
    (tester) async {
      final turns = _controller(tester);
      await _view(tester, turns);
      final finger = await tester.startGesture(const Offset(300, 500));
      for (var i = 1; i <= 10; i += 1) {
        await finger.moveTo(Offset(300 - 3.0 * i, 500 - 30.0 * i));
      }
      expect(turns.isTurning, isFalse);
      await finger.up();
      await tester.pumpAndSettle();
      expect(turns.isTurning, isFalse);
      expect(turns.reader.lastChange, isNot(RitoPageChange.turn));
    },
  );

  testWidgets('a mouse does not turn the page', (tester) async {
    final turns = _controller(tester);
    await _view(tester, turns);
    final mouse = await tester.startGesture(
      const Offset(300, 300),
      kind: PointerDeviceKind.mouse,
    );
    await mouse.moveTo(const Offset(100, 300));
    expect(turns.isTurning, isFalse);
    await mouse.up();
    await tester.pumpAndSettle();
  });

  testWidgets(
    'a finger whose page is not there yet waits for it, then takes it where the finger is',
    (tester) async {
      final source = FakePageSource()..peekGate = Completer<void>();
      final reader = RitoReaderController.withSource(
        source,
        layout: fakeLayout,
      );
      final turns = RitoPageTurnController(
        reader: reader,
        vsync: tester,
        paintPage: (canvas, size, page) {},
      )..width = 400;
      addTearDown(() {
        turns.dispose();
        reader.dispose();
      });
      await tester.pump();
      turns
        ..dragStart(const Offset(300, 300))
        ..dragUpdate(const Offset(280, 300))
        ..dragUpdate(const Offset(240, 300))
        ..dragUpdate(const Offset(250, 300));
      // No turn while the next page is on its way, nothing drawn of one.
      expect(turns.isTurning, isFalse);
      expect(turns.frame.offset, 0);
      source.peekGate!.complete();
      source.peekGate = null;
      await tester.pump();
      // The page is where the finger is by now, the farthest it went kept.
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, -50);
      expect(turns.frame.touch!.farthest, const Offset(240, 300));
      turns.dragEnd();
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets('a key whose page is not there yet turns once it is', (
    tester,
  ) async {
    final source = FakePageSource()..peekGate = Completer<void>();
    final reader = RitoReaderController.withSource(source, layout: fakeLayout);
    final turns = RitoPageTurnController(
      reader: reader,
      vsync: tester,
      paintPage: (canvas, size, page) {},
    )..width = 400;
    addTearDown(() {
      turns.dispose();
      reader.dispose();
    });
    await tester.pump();
    expect(turns.turn(RitoAdjacentDirection.next), isTrue);
    expect(turns.isTurning, isFalse);
    source.peekGate!.complete();
    source.peekGate = null;
    await tester.pump();
    expect(turns.direction, RitoAdjacentDirection.next);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 100));
  });

  testWidgets('a key turn waits for an effect that cannot draw its pages yet', (
    tester,
  ) async {
    final turns = _controller(tester);
    final effect = _Gated();
    turns.effect = effect;
    await tester.pump();
    expect(turns.turn(RitoAdjacentDirection.next), isTrue);
    expect(turns.isTurning, isFalse);
    expect(effect.asked, isNonZero);
    effect.open();
    expect(turns.direction, RitoAdjacentDirection.next);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 100));
  });

  testWidgets(
    'a finger waits for the effect, then takes the page where the finger is',
    (tester) async {
      final turns = _controller(tester);
      final effect = _Gated();
      turns.effect = effect;
      await tester.pump();
      turns
        ..dragStart(const Offset(300, 300))
        ..dragUpdate(const Offset(280, 300))
        ..dragUpdate(const Offset(240, 300))
        ..dragUpdate(const Offset(250, 300));
      expect(turns.isTurning, isFalse);
      effect.open();
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, -50);
      expect(turns.frame.touch!.farthest, const Offset(240, 300));
      turns.dragEnd();
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'a jump played as a turn shows the page it leaves until the effect can draw the one it brings',
    (tester) async {
      final turns = _controller(tester);
      final effect = _Gated();
      turns.effect = effect;
      await tester.pump();
      await turns.jumpTo(
        const RitoLocator(href: 'b.xhtml'),
        animateAs: RitoAdjacentDirection.next,
      );
      for (var i = 0; i < 5; i += 1) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, 0);
      effect.open();
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 16));
      expect(turns.frame.offset, lessThan(0));
      await tester.pumpAndSettle();
      expect(turns.isTurning, isFalse);
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'a turn waiting for the effect is taken up again when the book is paginated meanwhile',
    (tester) async {
      final source = FakePageSource(paginationSteps: 2);
      final turns = _controller(tester, source: source);
      final effect = _Gated();
      turns.effect = effect;
      await tester.pump();
      expect(turns.turn(RitoAdjacentDirection.next), isTrue);
      expect(turns.isTurning, isFalse);
      // The whole book laid out and the page on screen renumbered, its
      // neighbours peeked again and still on their way when the effect
      // says it can draw.
      source.peekGate = Completer<void>();
      while (!turns.reader.paginationComplete) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      effect.open();
      source.peekGate!.complete();
      source.peekGate = null;
      await tester.pump();
      await tester.pump();
      expect(turns.direction, RitoAdjacentDirection.next);
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets(
    'a turn waiting for its page is taken up again when the book is paginated meanwhile',
    (tester) async {
      // A pagination step under way, the page a turn brings in asked for
      // behind it.
      final source = FakePageSource(paginationSteps: 1)
        ..paginationGate = Completer<void>();
      final turns = _controller(tester, source: source, prewarm: false);
      final started = <RitoAdjacentDirection>[];
      final events = turns.events.listen((event) {
        if (event is RitoPageTurnStarted) started.add(event.direction);
      });
      addTearDown(events.cancel);
      // Background pagination starts after the first frame; its first step
      // waits at the gate.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      expect(turns.turn(RitoAdjacentDirection.next), isTrue);
      expect(turns.isTurning, isFalse);
      // The step adopts the whole book's layout before the page comes.
      source.paginationGate!.complete();
      source.paginationGate = null;
      for (var i = 0; i < 20; i += 1) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(source.paginations, 1);
      expect(started, [RitoAdjacentDirection.next]);
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 100));
    },
  );

  testWidgets('a turn begins without an effect that cannot draw it for long', (
    tester,
  ) async {
    final turns = _controller(tester);
    turns.effect = _Gated();
    await tester.pump();
    expect(turns.turn(RitoAdjacentDirection.next), isTrue);
    await tester.pump(const Duration(milliseconds: 400));
    expect(turns.isTurning, isFalse);
    await tester.pump(const Duration(milliseconds: 200));
    expect(turns.direction, RitoAdjacentDirection.next);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 100));
  });

  test('measures the finger as the web does', () {
    final motion = RitoTurnMotion(const RitoPageTurnPhysics())
      ..width = 400
      ..startDrag(forward: true, hasIncoming: true, at: 1016)
      ..drag(-10, at: 1016)
      ..drag(-30, at: 1033)
      ..drag(-60, at: 1050);
    // The web's estimate: each step's speed, the later ones weighing more,
    // none shorter than a millisecond (the first sample shares the start's
    // time); px/ms, let go as px/s.
    const steps = [(-10 - 0) / 1, (-30 + 10) / 17, (-60 + 30) / 17];
    final expected = (steps[0] * 1 + steps[1] * 2 + steps[2] * 3) / 6 * 1000;
    expect(motion.fingerVelocity, closeTo(expected, 1e-9));
    // Only the last five samples count.
    for (var i = 1; i <= 5; i += 1) {
      motion.drag(-60 - 10.0 * i, at: 1050 + 10.0 * i);
    }
    expect(motion.fingerVelocity, closeTo(-1000, 1e-9));
  });
}

final class _Bell extends ChangeNotifier {
  void ring() => notifyListeners();
}

/// An effect that cannot draw any turn until it is opened, and then says so.
final class _Gated extends RitoLayeredPageTurnEffect {
  final _bell = _Bell();
  bool _open = false;
  int asked = 0;

  @override
  Listenable get repaint => _bell;

  @override
  bool canDraw(RitoPageTurnPages pages, RitoPageSlot incoming) {
    asked += 1;
    return _open;
  }

  void open() {
    _open = true;
    _bell.ring();
  }

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) => [
    RitoPageTurnLayer(RitoPageSlot.current, frame.offset),
  ];
}
