import 'dart:convert';
import 'dart:io';

import 'package:flutter/physics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/turn/effects.dart';
import 'package:rito_flutter/src/turn/motion.dart';

RitoTurnMotion _motion() =>
    RitoTurnMotion(const RitoPageTurnPhysics())..width = 400;

/// Takes one second to rest at constant speed, and counts the motions asked of it.
final class _CountedPhysics extends RitoPageTurnPhysics {
  int settles = 0;

  @override
  Simulation settle({
    required double from,
    required double velocity,
    required double to,
  }) {
    settles += 1;
    return _Steady(from, to);
  }
}

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

/// Begins every turn that cuts in from rest, and keeps what it was told.
final class _FromRestPhysics extends RitoPageTurnPhysics {
  final List<RitoPageTurnLeftover> asked = <RitoPageTurnLeftover>[];

  @override
  ({double offset, double velocity}) begins(RitoPageTurnLeftover leftover) {
    asked.add(leftover);
    return (offset: 0, velocity: 0);
  }
}

/// Steps until rest; returns the offsets the spring passed through.
List<double> _settle(RitoTurnMotion motion) {
  final seen = <double>[];
  for (var i = 0; i < 600 && motion.phase != RitoTurnMotionPhase.idle; i++) {
    motion.step(1 / 60);
    seen.add(motion.offset);
  }
  return seen;
}

var _now = 0.0;

/// Carries the turn to [travel], the finger going [velocity] px/s as it
/// gets there: five samples a millisecond apart.
void _carry(RitoTurnMotion motion, double travel, [double velocity = 0]) {
  for (var i = 4; i >= 0; i -= 1) {
    _now += 1;
    motion.drag(travel - velocity * i / 1000, at: _now);
  }
}

void main() {
  test('a drag past the threshold turns the page and lands on it', () {
    final motion = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(motion, -60, 0);
    expect(motion.release(), isTrue);
    final seen = _settle(motion);
    expect(motion.offset, -400);
    expect(seen.reduce((a, b) => a < b ? a : b), greaterThanOrEqualTo(-400));
  });

  test('a short drag goes back unless it was flicked', () {
    final slow = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(slow, -10, -20);
    expect(slow.release(), isFalse);
    _settle(slow);
    expect(slow.offset, 0);

    final flick = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(flick, -10, -500);
    expect(flick.release(), isTrue);
  });

  test('dragging back past the start or pulling back keeps the page', () {
    final reversed = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(reversed, 20, -900);
    expect(reversed.release(), isFalse);

    final pulling = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(pulling, -200, 80);
    expect(pulling.release(), isFalse);
  });

  test('a released flick carries its momentum into the spring', () {
    final rest = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(rest, -60, 0);
    rest.release();
    final flick = _motion()
      ..startDrag(forward: true, hasIncoming: true, at: _now);
    _carry(flick, -60, -2000);
    flick.release();
    expect(_settle(flick).length, lessThan(_settle(rest).length));
  });

  test('no preset carries a turn past the neighbour, however hard flicked', () {
    for (final spring in [
      RitoSpring.standard,
      RitoSpring.snappy,
      RitoSpring.gentle,
    ]) {
      for (final velocity in [0.0, -800.0, -3000.0, -20000.0]) {
        final motion = RitoTurnMotion(RitoPageTurnPhysics(spring: spring))
          ..width = 400
          ..startDrag(forward: true, hasIncoming: true, at: _now);
        _carry(motion, -60, velocity);
        motion.release();
        var lowest = 0.0;
        for (var i = 0; i < 400 && !motion.step(1 / 120); i++) {
          lowest = lowest < motion.offset ? lowest : motion.offset;
        }
        expect(lowest, greaterThanOrEqualTo(-400));
      }
    }
  });

  test('a turn traces the same path whatever the frame rate', () {
    double at(double frame) {
      final motion = _motion()..turn(forward: true);
      for (var t = 0.0; t < 0.3 - 1e-9; t += frame) {
        motion.step(frame);
      }
      return motion.offset;
    }

    final reference = at(0.001);
    for (final frame in [0.006, 0.0075, 0.01, 0.012, 0.015, 0.02, 0.03]) {
      expect(at(frame), closeTo(reference, 1e-6));
    }
  });

  test('the spring is the web reader\'s curve, sample for sample', () {
    final table =
        jsonDecode(
              File(
                '../kit/tests/fixtures/spring-samples.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    const presets = {
      'default': RitoSpring.standard,
      'snappy': RitoSpring.snappy,
      'gentle': RitoSpring.gentle,
    };
    for (final entry
        in (table['cases']! as List<Object?>).cast<Map<String, Object?>>()) {
      final custom = entry['spring'] as Map<String, Object?>?;
      final spring = custom == null
          ? presets[entry['preset']]!
          : RitoSpring(
              stiffness: (custom['stiffness']! as num).toDouble(),
              damping: (custom['damping']! as num).toDouble(),
            );
      for (final sample
          in (entry['samples']! as List<Object?>)
              .cast<Map<String, Object?>>()) {
        final value = springAt(
          spring,
          (entry['offset']! as num).toDouble(),
          (entry['velocity']! as num).toDouble(),
          (sample['t']! as num).toDouble(),
        );
        expect(
          value.offset,
          closeTo((sample['offset']! as num).toDouble(), 1e-6),
        );
        expect(
          value.velocity,
          closeTo((sample['velocity']! as num).toDouble(), 1e-6),
        );
      }
    }
  });

  group('a turn that is cut into', () {
    /// A turn to the next page, part of the way there.
    RitoTurnMotion inFlight() {
      final motion = _motion()..turn(forward: true);
      for (var i = 0; i < 6; i++) {
        motion.step(1 / 60);
      }
      return motion;
    }

    test('carries its picture on, the page it left still leaving', () {
      final motion = inFlight();
      final offset = motion.offset;
      final velocity = motion.velocity;
      expect(offset, lessThan(0));

      motion.carryOn(committed: true);

      // The same picture in the coordinates of the page it landed on.
      expect(motion.phase, RitoTurnMotionPhase.finishing);
      expect(motion.offset, closeTo(offset + 400, 1e-9));
      expect(motion.velocity, velocity);
      expect(motion.showing, RitoPageSlot.previous);
      // Coming to rest is no turn coming to rest: its turn is over.
      var said = false;
      for (var i = 0; i < 600 && motion.moving; i++) {
        said = motion.step(1 / 60) || said;
        expect(motion.offset, greaterThanOrEqualTo(0));
      }
      expect(said, isFalse);
      expect(motion.phase, RitoTurnMotionPhase.idle);
      expect(motion.offset, 0);
    });

    test('stays where it is when it was going back', () {
      final motion = _motion()
        ..startDrag(forward: true, hasIncoming: true, at: _now);
      motion
        ..drag(-120, at: _now)
        ..cancel()
        ..step(1 / 60);
      final offset = motion.offset;
      motion.carryOn(committed: false);
      expect(motion.offset, offset);
      expect(motion.showing, RitoPageSlot.next);
    });

    test('keeps the motion it was on rather than starting one', () {
      final physics = _CountedPhysics();
      final motion = RitoTurnMotion(physics)
        ..width = 400
        ..turn(forward: true)
        ..step(0.5);
      expect(motion.offset, closeTo(-200, 1e-9));
      motion.carryOn(committed: true);
      expect(physics.settles, 1);
      // Three quarters of the way through that same second.
      motion.step(0.25);
      expect(motion.offset, closeTo(100, 1e-9));
    });

    test('hands its picture and its speed to the turn that cuts in', () {
      final motion = inFlight();
      final offset = motion.offset;
      final velocity = motion.velocity;
      motion
        ..carryOn(committed: true)
        ..turn(forward: true);

      expect(motion.phase, RitoTurnMotionPhase.settling);
      expect(motion.offset, closeTo(offset + 400, 1e-9));
      expect(motion.velocity, velocity);
      // Still the page that turn was leaving, until this one crosses its start.
      expect(motion.onFarSide, isTrue);
      expect(motion.showing, RitoPageSlot.previous);
      final seen = _settle(motion);
      expect(motion.offset, -400);
      expect(motion.showing, RitoPageSlot.next);
      for (var i = 1; i < seen.length; i++) {
        expect(seen[i], lessThanOrEqualTo(seen[i - 1]));
      }
    });

    test(
      'is never more than a page from rest, however often it is cut into',
      () {
        final motion = _motion()
          ..turn(forward: true)
          ..step(1 / 60)
          ..carryOn(committed: true)
          ..turn(forward: true);
        expect(motion.offset, greaterThan(0));
        motion.carryOn(committed: true);
        expect(motion.offset, 400);
      },
    );

    test(
      'under a finger adds what the finger carries, and is let go by that',
      () {
        final motion = inFlight()..carryOn(committed: true);
        final left = motion.offset;
        expect(left, greaterThan(150));
        motion
          ..startDrag(forward: true, hasIncoming: true, at: _now)
          ..drag(-120, at: _now);
        expect(motion.offset, closeTo(left - 120, 1e-9));
        // Still short of its own start, and a pull toward the next page all the same.
        expect(motion.release(), isTrue);
      },
    );

    test('against the end of the book resists the pull, not what was left', () {
      final motion = inFlight()..carryOn(committed: true);
      final left = motion.offset;
      motion
        ..startDrag(forward: true, hasIncoming: false, at: _now)
        ..drag(-40, at: _now);
      final pulled = motion.offset - left;
      expect(pulled, lessThan(0));
      expect(pulled, greaterThan(-40));
      expect(motion.showing, RitoPageSlot.previous);
    });

    test('begins where its physics say, told what was left', () {
      final physics = _FromRestPhysics();
      final motion = RitoTurnMotion(physics)
        ..width = 400
        ..turn(forward: true);
      for (var i = 0; i < 6; i++) {
        motion.step(1 / 60);
      }
      final offset = motion.offset;
      motion
        ..carryOn(committed: true)
        ..turn(forward: true);
      expect(physics.asked.single.offset, closeTo(offset + 400, 1e-9));
      expect(physics.asked.single.samePages, isFalse);
      // It starts at rest, and shows nothing of the turn before.
      expect(motion.offset, 0);
      expect(motion.showing, RitoPageSlot.next);

      motion
        ..carryOn(committed: true)
        ..turn(forward: false);
      expect(physics.asked.last.samePages, isTrue);
    });
  });

  test('a pull with no neighbour stretches and never turns', () {
    final motion = _motion()
      ..startDrag(forward: true, hasIncoming: false, at: _now);
    _carry(motion, -400, -3000);
    expect(motion.offset, closeTo(-110, 0.001));
    expect(motion.release(), isFalse);
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
