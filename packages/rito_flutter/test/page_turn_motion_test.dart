import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/turn/motion.dart';

RitoTurnMotion _motion() =>
    RitoTurnMotion(const RitoPageTurnPhysics())..width = 400;

/// Steps until rest; returns the offsets the spring passed through.
List<double> _settle(RitoTurnMotion motion) {
  final seen = <double>[];
  for (var i = 0; i < 600 && motion.phase != RitoTurnMotionPhase.idle; i++) {
    motion.step(1 / 60);
    seen.add(motion.offset);
  }
  return seen;
}

void main() {
  test('a drag past the threshold turns the page and lands on it', () {
    final motion = _motion()..startDrag(forward: true, hasIncoming: true);
    motion.drag(-60);
    expect(motion.release(0), isTrue);
    final seen = _settle(motion);
    expect(motion.offset, -400);
    // A committed turn stops at the neighbour instead of overshooting.
    expect(seen.reduce((a, b) => a < b ? a : b), greaterThanOrEqualTo(-400));
  });

  test('a short drag goes back unless it was flicked', () {
    final slow = _motion()..startDrag(forward: true, hasIncoming: true);
    slow.drag(-10);
    expect(slow.release(-20), isFalse);
    _settle(slow);
    expect(slow.offset, 0);

    final flick = _motion()..startDrag(forward: true, hasIncoming: true);
    flick.drag(-10);
    expect(flick.release(-500), isTrue);
  });

  test('dragging back past the start or pulling back keeps the page', () {
    final reversed = _motion()..startDrag(forward: true, hasIncoming: true);
    reversed.drag(20);
    expect(reversed.release(-900), isFalse);

    final pulling = _motion()..startDrag(forward: true, hasIncoming: true);
    pulling.drag(-200);
    expect(pulling.release(80), isFalse);
  });

  test('a released flick carries its momentum into the spring', () {
    final rest = _motion()..startDrag(forward: true, hasIncoming: true);
    rest.drag(-60);
    rest.release(0);
    final flick = _motion()..startDrag(forward: true, hasIncoming: true);
    flick.drag(-60);
    flick.release(-2000);
    expect(_settle(flick).length, lessThan(_settle(rest).length));
  });

  test('a pull with no neighbour stretches and never turns', () {
    final motion = _motion()..startDrag(forward: true, hasIncoming: false);
    motion.drag(-400);
    expect(motion.offset, closeTo(-110, 0.001));
    expect(motion.release(-3000), isFalse);
    _settle(motion);
    expect(motion.offset, 0);
  });

  test('an instant turn lands on its first step', () {
    final motion = _motion()..turn(forward: false);
    expect(motion.step(1 / 60, instant: true), isTrue);
    expect(motion.offset, 400);
  });

  test('progress is the way toward the neighbour, clamped', () {
    expect(ritoTurnProgress(offset: -100, width: 400, forward: true), 0.25);
    expect(ritoTurnProgress(offset: 30, width: 400, forward: true), 0);
    expect(ritoTurnProgress(offset: 500, width: 400, forward: false), 1);
  });

  test('the physics are the web reader\'s', () {
    final effects = File('../kit/src/driver/effects.ts').readAsStringSync();
    final types = File('../kit/src/driver/types.ts').readAsStringSync();
    double number(String source, String pattern) =>
        double.parse(RegExp(pattern).firstMatch(source)!.group(1)!);
    for (final (name, spring) in [
      ('default', RitoSpring.standard),
      ('snappy', RitoSpring.snappy),
      ('gentle', RitoSpring.gentle),
    ]) {
      expect(
        number(effects, '$name: \\{ stiffness: (\\d+)'),
        spring.stiffness,
        reason: name,
      );
      expect(
        number(effects, '$name: \\{ stiffness: \\d+, damping: (\\d+)'),
        spring.damping,
        reason: name,
      );
    }
    const physics = RitoPageTurnPhysics();
    expect(number(types, r'swipeThreshold: (\d+)'), physics.swipeThreshold);
    // The web measures drag velocity in px/ms.
    expect(
      number(types, r'velocityCommit: ([\d.]+)') * 1000,
      physics.velocityCommit,
    );
    expect(number(types, r'elasticFactor: ([\d.]+)'), physics.elasticFactor);
    final projection = File(
      '../kit/src/driver/transition-actions.ts',
    ).readAsStringSync();
    expect(
      number(projection, r'PROJECTION_MS = (\d+)'),
      physics.projection.inMilliseconds,
    );
  });
}
