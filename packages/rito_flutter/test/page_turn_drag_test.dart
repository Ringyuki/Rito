import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/src/turn/motion.dart';

import 'support/fake_page_source.dart';

RitoPageTurnController _controller(WidgetTester tester) {
  final reader = RitoReaderController.withSource(
    FakePageSource(),
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
      // Past the slop up the page: a drag, but no way to turn yet.
      await finger.moveTo(const Offset(300, 307));
      expect(turns.isTurning, isFalse);
      await finger.moveTo(const Offset(290, 307));
      expect(turns.direction, RitoAdjacentDirection.next);
      expect(turns.frame.offset, -10);
      expect(turns.frame.touch!.origin, const Offset(300, 300));
      await finger.up();
      await tester.pumpAndSettle();
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
