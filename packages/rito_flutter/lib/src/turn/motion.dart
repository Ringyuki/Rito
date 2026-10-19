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
/// which way it turns and the finger itself. [from] is where the turn was
/// when the finger took it: 0 unless it began from what a turn in flight
/// had left, so `offset - from` is how far the finger carried it.
final class RitoPageTurnRelease {
  const RitoPageTurnRelease({
    required this.offset,
    this.from = 0,
    required this.velocity,
    required this.width,
    required this.forward,
    this.touch,
  });

  final double offset;
  final double from;
  final double velocity;
  final double width;
  final bool forward;
  final RitoPageTurnTouch? touch;
}

/// What a turn that cuts into another finds: where the picture is ([offset],
/// logical px, in the coordinates the turn cut into left: its page was this
/// far short of rest), how fast it moves ([velocity], logical px/s), the
/// page [width], which way the turn beginning goes, and whether it is
/// between the same two pages as the turn cut into: the same page, turned
/// again.
final class RitoPageTurnLeftover {
  const RitoPageTurnLeftover({
    required this.offset,
    required this.velocity,
    required this.width,
    required this.forward,
    required this.samePages,
  });

  final double offset;
  final double velocity;
  final double width;
  final bool forward;
  final bool samePages;
}

/// How a page turn moves, whatever it looks like. The defaults are the
/// web reader's (`@ritojs/kit`), so a book turns the same on both.
///
/// Extend it to move a turn another way: [travel] reads the finger,
/// [resist] holds the page at the ends of the book, [lands] decides a
/// release, [settle] carries the turn to rest and [begins] says where a
/// turn that cuts into another starts.
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

  /// [travel] in a turn [width] logical px wide: what the controller asks.
  /// Physics whose travel depends on the width the turn crosses override
  /// this; the rest are asked [travel].
  double travelAcross(Offset origin, Offset position, double width) =>
      travel(origin, position);

  /// Where a pull of [travel] px leaves the page when no neighbour lies
  /// that way: it stretches like a rubber band.
  double resist(double travel, double width) {
    if (travel == 0 || width <= 0) return 0;
    final stretch = 1 - 1 / (travel.abs() / width + 1);
    return travel.sign * stretch * width * elasticFactor;
  }

  /// Whether a turn let go turns the page; otherwise it goes back. Not
  /// asked at the ends of the book, where there is no page to turn to.
  ///
  /// The built-in rule goes by how far the finger carried the turn: where
  /// the turn was when the finger took it says nothing of what the finger
  /// meant.
  bool lands(RitoPageTurnRelease release) {
    final velocity = release.velocity;
    final carried = release.offset - release.from;
    final toward = release.forward ? -1.0 : 1.0;
    // Dragged back past where it took it, or pulling back: the page stays.
    if (carried * toward < 0 || velocity * toward < -50) return false;
    final seconds = projection.inMicroseconds / 1e6;
    return (carried + velocity * seconds).abs() > swipeThreshold ||
        velocity.abs() > velocityCommit;
  }

  /// Where a turn that cuts into another begins, and how fast: by default
  /// where the picture is and as fast, so nothing jumps. Physics that answer
  /// otherwise leave what was left of the other turn to their effect: the
  /// frames that follow are of the new turn alone.
  ({double offset, double velocity}) begins(RitoPageTurnLeftover leftover) =>
      (offset: leftover.offset, velocity: leftover.velocity);

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

enum RitoTurnMotionPhase {
  idle,
  dragging,
  settling,

  /// What was left of a turn that another cut into: its outcome is
  /// settled, and the picture goes the rest of the way to rest.
  finishing,
}

/// The neighbour a turn that was cut into left in the frame; [none] for a
/// pull against the end of the book, which shows no neighbour.
enum _Leaving { next, previous, none }

/// The motion of one page turn: the finger while dragging, then its
/// physics' simulation to the neighbour or back. Displacement is in logical
/// px, negative while turning forward. Pure: the caller supplies time.
///
/// A turn that another cuts into is not stopped: [carryOn] settles its
/// outcome and leaves its picture going, and the turn that cuts in begins
/// where that picture is.
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

  /// Added to what the simulation says: the coordinates moved when the turn
  /// it was made for landed.
  double _shift = 0;

  /// Where the turn was when the finger took it: what its travel adds to.
  double _from = 0;

  /// What the turn this one began from left in the frame; null when it
  /// began at rest.
  _Leaving? _leaving;

  RitoTurnMotionPhase get phase => _phase;
  double get offset => _offset;

  /// How fast the turn is moving, logical px/s; 0 while a finger holds it.
  double get velocity =>
      _phase == RitoTurnMotionPhase.settling ||
          _phase == RitoTurnMotionPhase.finishing
      ? _velocity
      : 0;

  /// Whether the turn goes toward the next page.
  bool get forward => _forward;

  /// Whether a neighbour lies the way the turn goes.
  bool get hasIncoming => _hasIncoming;

  /// Whether the spring is carrying the turn to the neighbour.
  bool get committing => _phase == RitoTurnMotionPhase.settling && _target != 0;

  /// Whether anything is moving by itself.
  bool get moving =>
      _phase == RitoTurnMotionPhase.settling ||
      _phase == RitoTurnMotionPhase.finishing;

  /// Whether the frame is still the picture of the turn this one cut into:
  /// it has not crossed its own start yet.
  bool get onFarSide =>
      _phase != RitoTurnMotionPhase.finishing &&
      _leaving != null &&
      (_forward ? _offset > 0 : _offset < 0);

  /// The neighbour in the frame: the turn's own, or the one the turn it
  /// cut into was leaving while this one is on the far side of its start.
  RitoPageSlot? get showing {
    final leaving = _leaving;
    if (leaving != null &&
        (_phase == RitoTurnMotionPhase.finishing || onFarSide)) {
      return switch (leaving) {
        _Leaving.next => RitoPageSlot.next,
        _Leaving.previous => RitoPageSlot.previous,
        _Leaving.none => null,
      };
    }
    if (!_hasIncoming) return null;
    return _forward ? RitoPageSlot.next : RitoPageSlot.previous;
  }

  /// A finger takes the turn: from rest, or from what a turn it cut into
  /// had left.
  void startDrag({required bool forward, required bool hasIncoming}) {
    final begun = _beginning(forward: forward, hasIncoming: hasIncoming);
    _phase = RitoTurnMotionPhase.dragging;
    _forward = forward;
    _hasIncoming = hasIncoming;
    _offset = begun.offset;
    _from = begun.offset;
    _leaving = begun.leaving;
    _velocity = 0;
    _settling = null;
    _shift = 0;
  }

  /// Follows a finger that has carried the turn [travel] px from where it
  /// took it; a pull with no neighbour is resisted, what the turn had
  /// already travelled is not.
  void drag(double travel) {
    if (_phase != RitoTurnMotionPhase.dragging) return;
    final carried = _hasIncoming ? travel : physics.resist(travel, width);
    _offset = _withinAPage(_from + carried);
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
            from: _from,
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

  /// Turns toward a neighbour without a finger (a tap, a key): from rest,
  /// from what a turn it cut into had left, or on from where a turn that
  /// was going back is.
  void turn({required bool forward}) {
    if (_phase == RitoTurnMotionPhase.idle ||
        _phase == RitoTurnMotionPhase.finishing) {
      final begun = _beginning(forward: forward, hasIncoming: true);
      _offset = begun.offset;
      _velocity = begun.velocity;
      _leaving = begun.leaving;
    }
    _forward = forward;
    _hasIncoming = true;
    _settleTo(_turnTarget);
  }

  /// Settles the outcome of the turn that is open and leaves its picture
  /// going: the rest of it, in the coordinates that outcome leaves. A turn
  /// that landed ([committed]) has a new current page: what was a page
  /// width short of arriving is now that far from rest, the page it left
  /// beside it. One that was going back stays where it is. Nothing lies
  /// more than a page from rest.
  void carryOn({required bool committed}) {
    if (_phase == RitoTurnMotionPhase.idle ||
        _phase == RitoTurnMotionPhase.finishing) {
      return;
    }
    final shift = committed ? (_forward ? width : -width) : 0.0;
    final moved = _offset + shift;
    final offset = _withinAPage(moved);
    final shown = showing;
    _leaving = committed
        ? (_forward ? _Leaving.previous : _Leaving.next)
        : switch (shown) {
            RitoPageSlot.next => _Leaving.next,
            RitoPageSlot.previous => _Leaving.previous,
            _ => _Leaving.none,
          };
    // A turn left alone keeps the motion it was on; one a finger held, or
    // cut short, starts one.
    final keeps =
        _phase == RitoTurnMotionPhase.settling &&
        _settling != null &&
        offset == moved;
    if (keeps) {
      _shift += shift;
    } else {
      if (_phase == RitoTurnMotionPhase.dragging) _velocity = 0;
      _settling = physics.settle(from: offset, velocity: _velocity, to: 0);
      _elapsed = 0;
      _shift = 0;
    }
    _offset = offset;
    _target = 0;
    _from = 0;
    _phase = RitoTurnMotionPhase.finishing;
  }

  /// Advances the turn [seconds]; true when a turn came to rest. [instant]
  /// lands at once. The motion is read off its simulation at the time
  /// elapsed, so its path is the same whatever the frame rate. What was
  /// left of a turn that was cut into comes to rest without saying so: its
  /// turn was over when it was cut into.
  bool step(double seconds, {bool instant = false}) {
    final settling = _settling;
    if (!moving || settling == null) return false;
    _elapsed += seconds;
    _offset = settling.x(_elapsed) + _shift;
    _velocity = settling.dx(_elapsed);
    if (instant || settling.isDone(_elapsed)) {
      final finishing = _phase == RitoTurnMotionPhase.finishing;
      finish();
      return !finishing;
    }
    return false;
  }

  /// Puts the turn where it was going and stops it.
  void finish() {
    _offset = _target;
    _velocity = 0;
    _phase = RitoTurnMotionPhase.idle;
    _settling = null;
    _shift = 0;
    if (_target == 0) _leaving = null;
  }

  void reset() {
    _phase = RitoTurnMotionPhase.idle;
    _offset = 0;
    _velocity = 0;
    _target = 0;
    _settling = null;
    _shift = 0;
    _from = 0;
    _leaving = null;
  }

  double get _turnTarget => _forward ? -width : width;

  /// A turn goes no farther than a page either way: beyond it there is no
  /// page to show.
  double _withinAPage(double offset) =>
      width > 0 ? offset.clamp(-width, width).toDouble() : offset;

  /// What a turn beginning now starts from: what its physics make of what
  /// the turn it cut into left, or rest.
  ({double offset, double velocity, _Leaving? leaving}) _beginning({
    required bool forward,
    required bool hasIncoming,
  }) {
    final leaving = _leaving;
    if (_phase != RitoTurnMotionPhase.finishing || leaving == null) {
      return (offset: 0, velocity: 0, leaving: null);
    }
    final own = !hasIncoming
        ? null
        : (forward ? _Leaving.next : _Leaving.previous);
    final at = physics.begins(
      RitoPageTurnLeftover(
        offset: _offset,
        velocity: _velocity,
        width: width,
        forward: forward,
        samePages: leaving == own,
      ),
    );
    // A turn that begins elsewhere shows nothing of the one it cut into.
    return (
      offset: at.offset,
      velocity: at.velocity,
      leaving: at.offset == _offset ? leaving : null,
    );
  }

  void _settleTo(double target) {
    _target = target;
    _phase = RitoTurnMotionPhase.settling;
    _settling = physics.settle(from: _offset, velocity: _velocity, to: target);
    _elapsed = 0;
    _shift = 0;
    _from = 0;
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
