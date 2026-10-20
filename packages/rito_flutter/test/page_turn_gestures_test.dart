// A finger turning pages, frame by frame, as the web reader turns them:
// the kit's fixtures/turn-gestures.json says, for each scenario, the
// touches, the frame times and what the turn draws at each frame. Here the
// touches go through the page turn view's recognizer and controller, and
// every frame is held to the web's.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

import 'support/fake_page_source.dart';

final _fixture =
    jsonDecode(
          File('../kit/tests/fixtures/turn-gestures.json').readAsStringSync(),
        )
        as Map<String, Object?>;

/// How far a frame may be from the web's: rounding, not a different motion.
const _tolerance = 1e-6;

String? _incoming(RitoPageSlot? slot) => switch (slot) {
  RitoPageSlot.next => 'next',
  RitoPageSlot.previous => 'prev',
  _ => null,
};

String _way(RitoAdjacentDirection direction) =>
    direction == RitoAdjacentDirection.next ? 'forward' : 'backward';

Future<void> _play(WidgetTester tester, Map<String, Object?> scenario) async {
  final width = (_fixture['width']! as num).toDouble();
  final reader = RitoReaderController.withSource(
    FakePageSource(),
    layout: fakeLayout,
  );
  final turns = RitoPageTurnController(
    reader: reader,
    vsync: tester,
    paintPage: (canvas, size, page) {},
  )..width = width;
  final starts = <String>[];
  final ends = <String>[];
  final events = turns.events.listen(
    (event) => switch (event) {
      RitoPageTurnStarted(:final direction) => starts.add(_way(direction)),
      RitoPageTurnEnded(:final outcome) => ends.add(outcome.name),
    },
  );
  addTearDown(() async {
    await events.cancel();
    turns.dispose();
    reader.dispose();
  });
  await tester.pumpWidget(
    Directionality(
      textDirection: TextDirection.ltr,
      child: Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: width,
          height: 600,
          child: RitoPageTurnView(
            controller: turns,
            child: const SizedBox.expand(),
          ),
        ),
      ),
    ),
  );
  // The pages beside the one shown are in their slots, as on the web.
  for (var i = 0; i < 4; i += 1) {
    await tester.pump(const Duration(milliseconds: 50));
  }

  final period = (scenario['frame']! as num).toInt();
  final until = (scenario['until']! as num).toInt();
  final touches = scenario['touches']! as List<Object?>;
  final expected = scenario['frames']! as List<Object?>;
  final gesture = await tester.createGesture();
  var next = 0;
  var frame = 0;
  for (var at = period; at <= until; at += period) {
    while (next < touches.length &&
        ((touches[next]! as List<Object?>)[1]! as num) <= at) {
      final touch = touches[next]! as List<Object?>;
      final when = Duration(microseconds: ((touch[1]! as num) * 1000).round());
      final where = Offset(
        (touch[2]! as num).toDouble(),
        (touch[3]! as num).toDouble(),
      );
      switch (touch[0]) {
        case 'down':
          await gesture.down(where, timeStamp: when);
        case 'move':
          await gesture.moveTo(where, timeStamp: when);
        case 'up':
          await gesture.up(timeStamp: when);
        case 'next':
          turns.turn(RitoAdjacentDirection.next);
        case 'prev':
          turns.turn(RitoAdjacentDirection.previous);
      }
      next += 1;
    }
    await tester.pump(Duration(milliseconds: period));
    final want = expected[frame] as Map<String, Object?>?;
    final drawn = turns.isMoving ? turns.frame : null;
    final where = '${scenario['name']} at $at ms';
    if (want == null) {
      expect(drawn, isNull, reason: '$where: the web draws no turn');
    } else {
      expect(drawn, isNotNull, reason: '$where: the web draws a turn');
      expect(
        drawn!.offset,
        closeTo((want['dx']! as num).toDouble(), _tolerance),
        reason: '$where: dx',
      );
      expect(drawn.phase.name, want['phase'], reason: '$where: phase');
      expect(
        _incoming(drawn.incoming),
        want['incoming'],
        reason: '$where: incoming',
      );
      expect(
        drawn.velocity,
        closeTo((want['velocity']! as num).toDouble(), _tolerance),
        reason: '$where: velocity',
      );
    }
    frame += 1;
  }
  expect(starts, scenario['starts'], reason: '${scenario['name']}: starts');
  expect(ends, scenario['ends'], reason: '${scenario['name']}: ends');
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  for (final scenario in _fixture['scenarios']! as List<Object?>) {
    final played = scenario! as Map<String, Object?>;
    testWidgets(
      'a finger turns pages as on the web: ${played['name']}',
      (tester) => _play(tester, played),
    );
  }
}
