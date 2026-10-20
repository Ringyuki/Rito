import 'dart:ui' show Offset;

import 'package:flutter/physics.dart';

import '../effects.dart';
import '../motion.dart';
import 'model.dart';

/// How a paper turn moves, as the engine's model has it (the web's
/// `paperPhysics`). A finger carries the edge of the page as far as it
/// goes; a page let go finishes by itself and its turn is over once it is
/// out of the frame or lying flat again; a turn that cuts into another
/// takes up the same page where it is. Lengths are logical px, which the
/// model reads as the web's CSS px. Flutter's pages are one a view, bound
/// at the left edge.
final class PaperTurnPhysics extends RitoPageTurnPhysics {
  PaperTurnPhysics(this._model, this._now);

  final RitoPaperTurnModel Function() _model;

  /// The clock the turn moves by, ms: the one its frames are read at.
  final double Function() _now;

  @override
  double travelAcross(Offset origin, Offset position, double width) => _model()
      .travel(RitoPageTurnTouch(origin: origin, position: position), width, 0);

  @override
  bool lands(RitoPageTurnRelease release) => _model().lands(
    dx: release.offset,
    from: release.from,
    velocity: release.velocity,
    width: release.width,
    forward: release.forward,
    touch: release.touch,
    spine: 0,
  );

  @override
  ({double offset, double velocity}) begins(RitoPageTurnLeftover leftover) {
    final begins = _model().begins(
      leftover.offset,
      leftover.velocity,
      sameSpreads: leftover.samePages,
    );
    return (offset: begins.dx, velocity: begins.velocity);
  }

  @override
  Simulation settle({
    required double from,
    required double velocity,
    required double to,
  }) => _PaperSettle(_model().settle(from, velocity, to), _now);
}

/// A settle stepped once for each moment it is asked about: the model's
/// settle moves on when stepped, and Flutter asks one moment its x, dx and
/// whether it is done.
final class _PaperSettle extends Simulation {
  _PaperSettle(this._settle, this._now) {
    _finalizer.attach(this, _settle);
  }

  static final _finalizer = Finalizer<RitoPaperTurnSettle>(
    (settle) => settle.dispose(),
  );

  final RitoPaperTurnSettle _settle;
  final double Function() _now;
  double? _time;
  ({double x, double velocity, bool done}) _at = (
    x: 0,
    velocity: 0,
    done: false,
  );

  ({double x, double velocity, bool done}) _step(double time) {
    if (_time != time) {
      _time = time;
      _at = _settle.step(time, _now());
    }
    return _at;
  }

  @override
  double x(double time) => _step(time).x;

  @override
  double dx(double time) => _step(time).velocity;

  @override
  bool isDone(double time) => _step(time).done;
}
