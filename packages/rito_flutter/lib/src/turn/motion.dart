import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Offset;

import 'package:flutter/physics.dart';

import '../native/bindings.dart';
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

/// How a page turn moves, whatever it looks like. Its numbers are the
/// engine's built-in rules' (the same on the web, `@ritojs/kit`, and on
/// every host); the defaults are the ones both readers have always turned
/// pages with.
///
/// Extend it to move a turn another way: [travel] reads the finger,
/// [resist] holds the page at the ends of the book, [lands] decides a
/// release, [settle] carries the turn to rest and [begins] says where a
/// turn that cuts into another starts. Each answers null to leave the
/// decision to the engine's rule, as these do.
class RitoPageTurnPhysics {
  const RitoPageTurnPhysics({
    this.spring = RitoSpring.standard,
    this.swipeThreshold = 50,
    this.velocityCommit = 400,
    this.projection = const Duration(milliseconds: 150),
    this.elasticFactor = 0.55,
  });

  /// The spring that carries a turn nothing holds to rest.
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
  /// that way. Null for the engine's rule: it stretches like a rubber band,
  /// never past [elasticFactor] of a page.
  double? resist(double travel, double width) => null;

  /// Whether a turn let go turns the page; otherwise it goes back. Not
  /// asked at the ends of the book, where there is no page to turn to.
  ///
  /// Null for the engine's rule, which goes by how far the finger carried
  /// the turn (where the turn was when the finger took it says nothing of
  /// what the finger meant): dragged back past where it took it, or pulling
  /// back, the page stays; otherwise it turns when that distance, its
  /// velocity projected over [projection] added, passes [swipeThreshold],
  /// or when the velocity passes [velocityCommit].
  bool? lands(RitoPageTurnRelease release) => null;

  /// Where a turn that cuts into another begins, and how fast. Null for the
  /// engine's rule: where the picture is and as fast, so nothing jumps.
  /// Physics that answer otherwise leave what was left of the other turn to
  /// their effect: the frames that follow are of the new turn alone.
  ({double offset, double velocity})? begins(RitoPageTurnLeftover leftover) =>
      null;

  /// The motion of a turn nothing holds, from [from] at [velocity] to
  /// [to]: the neighbour, a page width away, or 0, the page it left. A
  /// turn left alone stays on screen until the simulation is done, then
  /// stands at [to]. Null for the engine's [spring], which is at rest once
  /// what motion remains is sub-pixel.
  Simulation? settle({
    required double from,
    required double velocity,
    required double to,
  }) => null;
}

enum RitoTurnMotionPhase {
  idle,
  dragging,
  settling,

  /// What was left of a turn that another cut into: its outcome is
  /// settled, and the picture goes the rest of the way to rest.
  finishing,
}

/// The numbers the engine's rules go by, as [physics] gives them.
List<double> ritoTurnPhysicsNumbers(RitoPageTurnPhysics physics) => <double>[
  physics.spring.stiffness,
  physics.spring.damping,
  physics.swipeThreshold,
  physics.velocityCommit,
  physics.projection.inMicroseconds / 1e6,
  // A finger pulling the turn back faster than this (px/s) leaves the page.
  50,
  physics.elasticFactor,
];

/// The motion of one page turn: the engine's (the same on every host, to
/// the bit), with [physics] answering wherever it decides otherwise.
/// Displacement is in logical px, negative while turning forward. Pure: the
/// caller supplies time.
///
/// A turn that another cuts into is not stopped: [carryOn] settles its
/// outcome and leaves its picture going, and the turn that cuts in begins
/// where that picture is.
final class RitoTurnMotion {
  RitoTurnMotion(RitoPageTurnPhysics physics)
    : _physics = physics,
      _native = RitoNativeTurnMotion(ritoTurnPhysicsNumbers(physics));

  final RitoNativeTurnMotion _native;
  RitoPageTurnPhysics _physics;
  double _width = 0;

  /// The physics' own motion carrying the turn, and which of the engine's
  /// motions it carries.
  Simulation? _settle;
  double _settleGeneration = 0;

  RitoPageTurnPhysics get physics => _physics;
  set physics(RitoPageTurnPhysics value) {
    _physics = value;
    _configure();
  }

  /// The page width a turn travels.
  double get width => _width;
  set width(double value) {
    _width = value;
    _configure();
  }

  void _configure() {
    _native.physics.setAll(0, ritoTurnPhysicsNumbers(_physics));
    _native.configure(_width);
  }

  Float64List get _state => _native.state;

  RitoTurnMotionPhase get phase =>
      RitoTurnMotionPhase.values[_state[0].toInt()];
  double get offset => _state[3];

  /// How fast the turn is moving, logical px/s; 0 while a finger holds it.
  double get velocity => _state[4];

  /// Whether the turn goes toward the next page.
  bool get forward => _state[1] == 1;

  /// Whether a neighbour lies the way the turn goes.
  bool get hasIncoming => _state[2] == 1;

  /// How fast the finger carries the turn, logical px/s, from where the
  /// turn was at its last few samples.
  double get fingerVelocity => _state[7];

  /// Whether the turn goes to the neighbour by itself.
  bool get committing => _state[11] == 1;

  /// Whether anything is moving by itself.
  bool get moving =>
      phase == RitoTurnMotionPhase.settling ||
      phase == RitoTurnMotionPhase.finishing;

  /// Whether the frame is still the picture of the turn this one cut into:
  /// it has not crossed its own start yet.
  bool get onFarSide => _state[10] == 1;

  /// The neighbour in the frame: the turn's own, or the one the turn it
  /// cut into was leaving while this one is on the far side of its start.
  RitoPageSlot? get showing => switch (_state[9]) {
    1 => RitoPageSlot.next,
    2 => RitoPageSlot.previous,
    _ => null,
  };

  /// A finger takes the turn at [at] ms: from rest, or from what a turn it
  /// cut into had left. Its speed is measured from there.
  void startDrag({
    required bool forward,
    required bool hasIncoming,
    required double at,
  }) {
    _native.startDrag(
      forward: forward,
      hasIncoming: hasIncoming,
      at: at,
      begin: _beginOf(forward: forward, hasIncoming: hasIncoming),
    );
    _settle = null;
  }

  /// Follows a finger that has carried the turn [travel] px from where it
  /// took it, at [at] ms; a pull with no neighbour is resisted, what the
  /// turn had already travelled is not.
  void drag(double travel, {required double at}) {
    if (phase != RitoTurnMotionPhase.dragging) return;
    final resisted = hasIncoming ? null : _physics.resist(travel, _width);
    if (resisted == null) {
      _native.drag(travel, at: at);
    } else {
      _native.drag(resisted, at: at, carried: true);
    }
  }

  /// Lets go; true when the page turns. It goes as fast as the finger was
  /// carrying it.
  bool release({RitoPageTurnTouch? touch}) {
    if (phase != RitoTurnMotionPhase.dragging) return false;
    final lands = hasIncoming
        ? _physics.lands(
            RitoPageTurnRelease(
              offset: offset,
              from: _state[6],
              velocity: fingerVelocity,
              width: _width,
              forward: forward,
              touch: touch,
            ),
          )
        : null;
    final turned = _native.release(lands);
    _followSettle();
    return turned;
  }

  /// Sends a turn that is held or going by itself back to where it started
  /// (also one that arrived but could not land).
  void cancel() {
    _native.cancel();
    _followSettle();
  }

  /// Turns toward a neighbour without a finger (a tap, a key): from rest,
  /// from what a turn it cut into had left, or on from where a turn that
  /// was going back is.
  void turn({required bool forward}) {
    _native.turn(
      forward: forward,
      begin: _beginOf(forward: forward, hasIncoming: true),
    );
    _followSettle();
  }

  /// Settles the outcome of the turn that is open and leaves its picture
  /// going: the rest of it, in the coordinates that outcome leaves. A turn
  /// that landed ([committed]) has a new current page: what was a page
  /// width short of arriving is now that far from rest, the page it left
  /// beside it. One that was going back stays where it is.
  void carryOn({required bool committed}) {
    _native.carryOn(committed: committed);
    _followSettle();
  }

  /// Advances the turn [seconds]; true when a turn came to rest. [instant]
  /// lands at once. What was left of a turn that was cut into comes to rest
  /// without saying so: its turn was over when it was cut into.
  bool step(double seconds, {bool instant = false}) {
    if (!moving) return false;
    final settle = _settle;
    final elapsed = _state[8] + seconds;
    final step = _native.step(
      seconds,
      host: settle == null
          ? null
          : (
              x: settle.x(elapsed),
              velocity: settle.dx(elapsed),
              done: settle.isDone(elapsed),
            ),
      instant: instant,
    );
    if (step >= 2) _settle = null;
    // 2 and 3: a turn came to rest; 4: what was left of one did.
    return step == 2 || step == 3;
  }

  /// Puts the turn where it was going and stops it.
  void finish() {
    _native.finish();
    _settle = null;
  }

  void reset() {
    _native.reset();
    _settle = null;
  }

  /// Lets the engine's memory for the motion go.
  void dispose() => _native.dispose();

  /// Where the physics begin a turn that cuts into what is left of another,
  /// when they say; null for the engine's rule, or at rest.
  ({double offset, double velocity})? _beginOf({
    required bool forward,
    required bool hasIncoming,
  }) {
    final leaving = _state[13];
    if (phase != RitoTurnMotionPhase.finishing || leaving == 0) return null;
    final own = !hasIncoming ? null : (forward ? 1.0 : 2.0);
    return _physics.begins(
      RitoPageTurnLeftover(
        offset: offset,
        velocity: velocity,
        width: _width,
        forward: forward,
        samePages: leaving == own,
      ),
    );
  }

  /// Starts the physics' own motion when the engine has started one: from
  /// where, how fast and to where it says. Null leaves it to the spring.
  void _followSettle() {
    if (!moving || _state[14] == _settleGeneration) return;
    _settleGeneration = _state[14];
    _settle = _physics.settle(
      from: _state[15],
      velocity: _state[16],
      to: _state[17],
    );
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

/// Whether a finger come down at [origin] that has moved by [moved] moves
/// more along the way [physics] turn pages than across it: a finger sliding
/// up or down the page, as pages turn, is not turning it. The way is told by
/// the travel the physics give a step right and a step down from [origin]
/// (kit `alongTheTurn`).
bool alongTheTurn(
  RitoPageTurnPhysics physics,
  Offset origin,
  Offset moved,
  double width,
) {
  double step(Offset by) => physics.travelAcross(origin, origin + by, width);
  final right = step(const Offset(1, 0));
  final down = step(const Offset(0, 1));
  return (moved.dx * right + moved.dy * down).abs() >=
      (moved.dx * down - moved.dy * right).abs();
}
