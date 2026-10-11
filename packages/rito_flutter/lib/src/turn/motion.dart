import 'dart:math' as math;
import 'dart:ui' show Offset;

import 'package:flutter/physics.dart';

import 'effects.dart';

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

/// A turn at the moment its finger lets go: where the turn is ([offset],
/// logical px, negative toward the next page), how fast the finger was
/// carrying it ([velocity], logical px/s along the turn), the page [width],
/// which way it turns and the finger itself.
final class RitoPageTurnRelease {
  const RitoPageTurnRelease({
    required this.offset,
    required this.velocity,
    required this.width,
    required this.forward,
    this.touch,
  });

  final double offset;
  final double velocity;
  final double width;
  final bool forward;
  final RitoPageTurnTouch? touch;
}

/// How a page turn moves, whatever it looks like. The defaults are the
/// web reader's (`@ritojs/kit`), so a book turns the same on both.
///
/// Extend it to move a turn another way: [travel] reads the finger,
/// [resist] holds the page at the ends of the book, [lands] decides a
/// release and [settle] carries the turn to rest.
class RitoPageTurnPhysics {
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

  /// How far a finger at [position] has carried the turn since it took
  /// hold at [origin]: logical px, negative toward the next page, one page
  /// width for a whole turn. The way a drag first moves is the way its
  /// page turns.
  double travel(Offset origin, Offset position) => position.dx - origin.dx;

  /// Where a pull of [travel] px leaves the page when no neighbour lies
  /// that way: it stretches like a rubber band.
  double resist(double travel, double width) {
    if (travel == 0 || width <= 0) return 0;
    final stretch = 1 - 1 / (travel.abs() / width + 1);
    return travel.sign * stretch * width * elasticFactor;
  }

  /// Whether a turn let go turns the page; otherwise it goes back. Not
  /// asked at the ends of the book, where there is no page to turn to.
  bool lands(RitoPageTurnRelease release) {
    final RitoPageTurnRelease(:offset, :velocity) = release;
    final toward = release.forward ? -1.0 : 1.0;
    // Dragged back past the start, or pulling back: the page stays.
    if (offset * toward < 0 || velocity * toward < -50) return false;
    final seconds = projection.inMicroseconds / 1e6;
    return (offset + velocity * seconds).abs() > swipeThreshold ||
        velocity.abs() > velocityCommit;
  }

  /// The motion of a turn nothing holds, from [from] at [velocity] to
  /// [to]: the neighbour, a page width away, or 0, the page it left. A
  /// turn left alone stays on screen until the simulation is done, then
  /// stands at [to].
  Simulation settle({
    required double from,
    required double velocity,
    required double to,
  }) => _SpringSettle(spring, from, velocity, to);
}

/// The spring toward [to]. It is at rest once what motion remains is
/// sub-pixel: within half a pixel, and not fast enough to carry more than
/// half a pixel further.
final class _SpringSettle extends Simulation {
  _SpringSettle(RitoSpring spring, double from, double velocity, this.to)
    : _omega = math.sqrt(spring.stiffness),
      _spring = SpringSimulation(
        SpringDescription(
          mass: 1,
          stiffness: spring.stiffness,
          damping: spring.damping,
        ),
        from - to,
        0,
        _boundedVelocity(spring, from - to, velocity),
      );

  final double to;
  final double _omega;
  final SpringSimulation _spring;

  @override
  double x(double time) => to + _spring.x(time);

  @override
  double dx(double time) => _spring.dx(time);

  @override
  bool isDone(double time) =>
      _spring.x(time).abs() < 0.5 && _spring.dx(time).abs() / _omega < 0.5;

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
}

enum RitoTurnMotionPhase { idle, dragging, settling }

/// The motion of one page turn: the finger while dragging, then its
/// physics' simulation to the neighbour or back. Displacement is in logical
/// px, negative while turning forward. Pure: the caller supplies time.
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
  Simulation? _settling;
  double _elapsed = 0;

  RitoTurnMotionPhase get phase => _phase;
  double get offset => _offset;

  /// How fast the turn is moving, logical px/s; 0 while a finger holds it.
  double get velocity => _phase == RitoTurnMotionPhase.settling ? _velocity : 0;

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

  /// Follows a finger that has carried the turn [travel] px; a pull with
  /// no neighbour is resisted.
  void drag(double travel) {
    if (_phase != RitoTurnMotionPhase.dragging) return;
    _offset = _hasIncoming ? travel : physics.resist(travel, width);
  }

  /// Lets go at [velocity] logical px/s; true when the page turns.
  bool release(double velocity, {RitoPageTurnTouch? touch}) {
    if (_phase != RitoTurnMotionPhase.dragging) return false;
    _velocity = velocity;
    final lands =
        _hasIncoming &&
        physics.lands(
          RitoPageTurnRelease(
            offset: _offset,
            velocity: velocity,
            width: width,
            forward: _forward,
            touch: touch,
          ),
        );
    _settleTo(lands ? _turnTarget : 0);
    return lands;
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

  /// Advances the turn [seconds]; true when it came to rest. [instant]
  /// lands at once. The motion is read off its simulation at the time
  /// elapsed, so its path is the same whatever the frame rate.
  bool step(double seconds, {bool instant = false}) {
    final settling = _settling;
    if (_phase != RitoTurnMotionPhase.settling || settling == null) {
      return false;
    }
    _elapsed += seconds;
    _offset = settling.x(_elapsed);
    _velocity = settling.dx(_elapsed);
    if (instant || settling.isDone(_elapsed)) {
      finish();
      return true;
    }
    return false;
  }

  /// Puts the turn where it was going and stops it.
  void finish() {
    _offset = _target;
    _velocity = 0;
    _phase = RitoTurnMotionPhase.idle;
    _settling = null;
  }

  void reset() {
    _phase = RitoTurnMotionPhase.idle;
    _offset = 0;
    _velocity = 0;
    _target = 0;
    _settling = null;
  }

  double get _turnTarget => _forward ? -width : width;

  void _settleTo(double target) {
    _target = target;
    _phase = RitoTurnMotionPhase.settling;
    _settling = physics.settle(from: _offset, velocity: _velocity, to: target);
    _elapsed = 0;
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
