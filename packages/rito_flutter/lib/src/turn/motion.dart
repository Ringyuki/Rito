import 'dart:math' as math;

import 'package:flutter/physics.dart';

/// A damped spring: stiffness in 1/s², damping in 1/s. The presets are
/// damped at or just above critical, so a turn never bounces: past the
/// neighbour, or back past the page it started on, there may be no page to
/// show. A spring damped below critical bounces, and shows that gap.
final class RitoSpring {
  const RitoSpring({required this.stiffness, required this.damping});

  final double stiffness;
  final double damping;

  /// Between [snappy] and [gentle].
  static const RitoSpring standard = RitoSpring(stiffness: 180, damping: 27);

  /// Lands fast.
  static const RitoSpring snappy = RitoSpring(stiffness: 320, damping: 36);

  /// Drifts in.
  static const RitoSpring gentle = RitoSpring(stiffness: 110, damping: 21);
}

/// How a page turn moves, whatever it looks like. The defaults are the
/// web reader's (`@ritojs/kit`), so a book turns the same on both.
final class RitoPageTurnPhysics {
  const RitoPageTurnPhysics({
    this.spring = RitoSpring.standard,
    this.swipeThreshold = 50,
    this.velocityCommit = 400,
    this.projection = const Duration(milliseconds: 150),
    this.elasticFactor = 0.55,
  });

  final RitoSpring spring;

  /// A drag released this far (logical px, after projecting its velocity
  /// over [projection]) turns the page.
  final double swipeThreshold;

  /// A drag released this fast (logical px/s) turns the page however far
  /// it went.
  final double velocityCommit;
  final Duration projection;

  /// How hard a pull against the first or last page resists (0–1).
  final double elasticFactor;
}

enum RitoTurnMotionPhase { idle, dragging, settling }

/// The motion of one page turn: the finger while dragging, then a spring
/// to the neighbour or back. Displacement is in logical px, negative while
/// turning forward. Pure: the caller supplies time.
final class RitoTurnMotion {
  RitoTurnMotion(this.physics);

  RitoPageTurnPhysics physics;

  /// The page width a turn travels.
  double width = 0;

  RitoTurnMotionPhase _phase = RitoTurnMotionPhase.idle;
  bool _forward = true;
  bool _hasIncoming = true;
  double _offset = 0;
  double _velocity = 0;
  double _target = 0;

  RitoTurnMotionPhase get phase => _phase;
  double get offset => _offset;

  /// Whether the turn goes toward the next page.
  bool get forward => _forward;

  /// Whether a neighbour lies the way the turn goes.
  bool get hasIncoming => _hasIncoming;

  /// Whether the spring is carrying the turn to the neighbour.
  bool get committing => _phase == RitoTurnMotionPhase.settling && _target != 0;

  void startDrag({required bool forward, required bool hasIncoming}) {
    _phase = RitoTurnMotionPhase.dragging;
    _forward = forward;
    _hasIncoming = hasIncoming;
    _offset = 0;
    _velocity = 0;
  }

  /// Picks a settling turn back up under the finger, where it is.
  void resumeDrag() {
    if (_phase == RitoTurnMotionPhase.settling) {
      _phase = RitoTurnMotionPhase.dragging;
    }
  }

  /// Follows the finger [rawOffset] px from where the drag began; a pull
  /// with no neighbour stretches like a rubber band.
  void drag(double rawOffset) {
    if (_phase != RitoTurnMotionPhase.dragging) return;
    _offset = _hasIncoming ? rawOffset : _rubberBand(rawOffset);
  }

  /// Lets go at [velocity] logical px/s; true when the page turns.
  bool release(double velocity) {
    if (_phase != RitoTurnMotionPhase.dragging) return false;
    _velocity = velocity;
    final commit = _hasIncoming && _releaseCommits(velocity);
    _settleTo(commit ? _turnTarget : 0);
    return commit;
  }

  /// Sends the turn back to where it started (also from a turn that
  /// arrived but could not land).
  void cancel() {
    if (_phase == RitoTurnMotionPhase.idle && _offset == 0) return;
    _settleTo(0);
  }

  /// Turns toward a neighbour without a finger (a tap, a key).
  void turn({required bool forward}) {
    _forward = forward;
    _hasIncoming = true;
    if (_phase == RitoTurnMotionPhase.idle) {
      _offset = 0;
      _velocity = 0;
    }
    _settleTo(_turnTarget);
  }

  /// Advances the spring [seconds]; true when it came to rest. [instant]
  /// lands at once. The spring is solved in closed form from where it is,
  /// so its path is the same whatever the frame rate.
  bool step(double seconds, {bool instant = false}) {
    if (_phase != RitoTurnMotionPhase.settling) return false;
    final spring = physics.spring;
    final offset = _offset - _target;
    final next = springAt(
      spring,
      offset,
      _boundedVelocity(spring, offset, _velocity),
      seconds,
    );
    _offset = _target + next.offset;
    _velocity = next.velocity;
    // At rest once what motion remains is sub-pixel: within half a pixel,
    // and not fast enough to carry more than half a pixel further.
    final omega = math.sqrt(spring.stiffness);
    final atRest =
        (_offset - _target).abs() < 0.5 && _velocity.abs() / omega < 0.5;
    if (instant || atRest) {
      finish();
      return true;
    }
    return false;
  }

  /// Puts the turn where its spring was going and stops it.
  void finish() {
    _offset = _target;
    _velocity = 0;
    _phase = RitoTurnMotionPhase.idle;
  }

  void reset() {
    _phase = RitoTurnMotionPhase.idle;
    _offset = 0;
    _velocity = 0;
    _target = 0;
  }

  double get _turnTarget => _forward ? -width : width;

  /// A spring that does not oscillate passes its target only when it
  /// starts toward it faster than ω times the distance; bounding a
  /// handed-over velocity there keeps it on its side of the target, with
  /// the motion continuous. An oscillating spring was chosen to bounce.
  static double _boundedVelocity(
    RitoSpring spring,
    double offset,
    double velocity,
  ) {
    final omega = math.sqrt(spring.stiffness);
    if (spring.damping < 2 * omega || offset == 0) return velocity;
    final limit = omega * offset.abs();
    final toward = -offset.sign * velocity;
    return toward > limit ? -offset.sign * limit : velocity;
  }

  void _settleTo(double target) {
    _target = target;
    _phase = RitoTurnMotionPhase.settling;
  }

  bool _releaseCommits(double velocity) {
    final toward = _forward ? -1.0 : 1.0;
    // Dragged back past the start, or pulling back: the page stays.
    if (_offset * toward < 0 || velocity * toward < -50) return false;
    final seconds = physics.projection.inMicroseconds / 1e6;
    return (_offset + velocity * seconds).abs() > physics.swipeThreshold ||
        velocity.abs() > physics.velocityCommit;
  }

  double _rubberBand(double raw) {
    if (raw == 0 || width <= 0) return 0;
    final travel = 1 - 1 / (raw.abs() / width + 1);
    return raw.sign * travel * width * physics.elasticFactor;
  }
}

/// How far a turn at [offset] has gone toward its neighbour: 0 at rest,
/// 1 on arrival.
double ritoTurnProgress({
  required double offset,
  required double width,
  required bool forward,
}) {
  if (width <= 0) return 0;
  final toward = forward ? -offset : offset;
  return math.min(1, math.max(0, toward / width));
}

/// The spring's offset from its target and its velocity [t] seconds on,
/// from [offset] (px) and [velocity] (px/s), solved in closed form.
({double offset, double velocity}) springAt(
  RitoSpring spring,
  double offset,
  double velocity,
  double t,
) {
  final simulation = SpringSimulation(
    SpringDescription(
      mass: 1,
      stiffness: spring.stiffness,
      damping: spring.damping,
    ),
    offset,
    0,
    velocity,
  );
  return (offset: simulation.x(t), velocity: simulation.dx(t));
}
