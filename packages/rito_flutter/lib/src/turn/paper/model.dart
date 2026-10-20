import 'dart:typed_data';

import '../../native/bindings.dart';
import '../effects.dart';

/// A page a turn may show: the spread printed on it, and the host's number
/// for the buffer it is painted in, the same while that buffer is repainted.
final class RitoPaperTurnPage {
  const RitoPaperTurnPage({required this.spread, required this.buffer});

  final int spread;
  final int buffer;
}

/// One frame of a turn, as the engine's model reads it: the frame's size in
/// the units it is drawn in, where the pages are bound (0 with one page a
/// spread) and how many units a CSS px is; how far the turn has gone,
/// which neighbour comes in, what moves it and the finger that moved it;
/// the page shown and the incoming one; the time in ms and the host's GPU
/// context.
final class RitoPaperTurnInput {
  const RitoPaperTurnInput({
    required this.width,
    required this.height,
    required this.spine,
    required this.cssPixel,
    required this.dx,
    required this.incoming,
    required this.phase,
    required this.touch,
    required this.current,
    required this.incomingPage,
    required this.now,
    required this.epoch,
  });

  final double width;
  final double height;
  final double spine;
  final double cssPixel;
  final double dx;
  final RitoPageSlot? incoming;
  final RitoPageTurnPhase phase;
  final RitoPageTurnTouch? touch;
  final RitoPaperTurnPage? current;
  final RitoPaperTurnPage? incomingPage;
  final double now;
  final int epoch;
}

/// Leaves the model forgot: the host lets their pages go when [release]
/// says they are still its own.
final class RitoPaperTurnForgotten {
  const RitoPaperTurnForgotten(this.leaves, {required this.release});

  final List<int> leaves;
  final bool release;
}

/// A frame read: whether a leaf turns (else the page shown is drawn where
/// the turn has it), the spread printed on it, and whether what was
/// remembered was of another moment.
final class RitoPaperTurnBegun {
  const RitoPaperTurnBegun({
    required this.turns,
    required this.spread,
    required this.anew,
    required this.forgotten,
  });

  final bool turns;
  final int spread;
  final bool anew;
  final RitoPaperTurnForgotten forgotten;
}

/// A frame laid out: the led leaf and the pages it shows now, the leaves
/// that left the book, and the grid and number of its sheets.
final class RitoPaperTurnLaid {
  const RitoPaperTurnLaid({
    required this.led,
    required this.front,
    required this.after,
    required this.leftBook,
    required this.columns,
    required this.rows,
    required this.sheets,
  });

  final int led;
  final RitoPaperTurnPage? front;
  final RitoPaperTurnPage? after;
  final List<int> leftBook;
  final int columns;
  final int rows;
  final int sheets;
}

/// The page a face of a sheet shows: the page a leaf was lifted from
/// ([front]) or the page under it.
final class RitoPaperTurnFace {
  const RitoPaperTurnFace({required this.leaf, required this.front});

  final int leaf;
  final bool front;
}

/// A page curled over: the direction it is rolled back from, the line it
/// leaves the page at, and the radius it rolls over at.
final class RitoPaperTurnCurl {
  const RitoPaperTurnCurl({
    required this.dx,
    required this.dy,
    required this.at,
    required this.radius,
  });

  final double dx;
  final double dy;
  final double at;
  final double radius;
}

/// A sheet of a frame: what its faces show, how far over it is (0 lying
/// right, 1 lying left), the name of its points while it lies still (null
/// for a sheet that moves), and its curl.
final class RitoPaperTurnSheet {
  const RitoPaperTurnSheet({
    required this.front,
    required this.back,
    required this.shown,
    required this.still,
    required this.curl,
  });

  final RitoPaperTurnFace? front;
  final RitoPaperTurnFace? back;
  final double shown;
  final int? still;
  final RitoPaperTurnCurl? curl;
}

/// A turn nothing holds, coming to rest: stepped once a frame.
final class RitoPaperTurnSettle {
  RitoPaperTurnSettle._(this._native);

  final RitoNativePaperTurnSettle _native;

  /// Where the turn is [seconds] after it was let go, at [now] (ms).
  ({double x, double velocity, bool done}) step(double seconds, double now) {
    final at = _native.step(seconds, now);
    return (x: at[0], velocity: at[1], done: at[2] == 1);
  }

  void dispose() => _native.dispose();
}

/// The paper page turn's motion and geometry, the engine's: frames in,
/// sheets out, the pages they show named by leaf. A frame is taken in two
/// steps, the host deciding between them whether it draws paper at all:
/// [begin], then [lay] and [sheet] for each sheet. One per reader.
final class RitoPaperTurnModel {
  RitoPaperTurnModel() : _native = RitoNativePaperTurn();

  final RitoNativePaperTurn _native;

  RitoPaperTurnBegun begin(RitoPaperTurnInput input) {
    _writeFrame(input, _native.frame);
    _native.begin();
    final begun = _native.begun;
    return RitoPaperTurnBegun(
      turns: begun[0] == 1,
      spread: begun[1].toInt(),
      anew: begun[2] == 1,
      forgotten: RitoPaperTurnForgotten(_leaves(), release: begun[3] == 1),
    );
  }

  /// Moves the leaves of the frame [begin] read on and lays them out; null
  /// when none waits.
  RitoPaperTurnLaid? lay(int epoch) {
    _native.lay(epoch);
    final laid = _native.laid;
    if (laid[0] != 1) return null;
    return RitoPaperTurnLaid(
      led: laid[1].toInt(),
      columns: laid[2].toInt(),
      rows: laid[3].toInt(),
      sheets: laid[4].toInt(),
      front: _page(laid, 5),
      after: _page(laid, 8),
      leftBook: _leaves(),
    );
  }

  /// Sheet [index] of the frame laid out; its points copied into [into]
  /// where given (`columns·rows·3` numbers each).
  RitoPaperTurnSheet sheet(int index, [RitoNativePaperTurnPoints? into]) {
    _native.sheet(index, into);
    final numbers = _native.sheetNumbers;
    final still = numbers[5].toInt();
    return RitoPaperTurnSheet(
      front: _face(numbers, 0),
      back: _face(numbers, 2),
      shown: numbers[4],
      still: still == 0 ? null : still,
      curl: numbers[6] == 1
          ? RitoPaperTurnCurl(
              dx: numbers[7],
              dy: numbers[8],
              at: numbers[9],
              radius: numbers[10],
            )
          : null,
    );
  }

  /// Nothing is in the air any more.
  RitoPaperTurnForgotten forget(int epoch) {
    final release = _native.forget(epoch);
    return RitoPaperTurnForgotten(_leaves(), release: release);
  }

  /// How many frames have been painted, whether the page the turn is of is
  /// where its turn takes it, whether it has left the frame for good, and
  /// whether a leaf left to come down still counts at [now] (ms).
  ({int painted, bool there, bool gone, bool aloft}) state(double now) {
    _native.readState(now);
    final state = _native.state;
    return (
      painted: state[0].toInt(),
      there: state[1] == 1,
      gone: state[2] == 1,
      aloft: state[3] == 1,
    );
  }

  /// How far a finger has carried a turn in a frame [width] wide bound at [spine].
  double travel(RitoPageTurnTouch touch, double width, double spine) {
    _native.numbers.setAll(0, [
      touch.origin.dx,
      touch.origin.dy,
      touch.position.dx,
      touch.position.dy,
    ]);
    return _native.travel(width, spine);
  }

  /// Whether a turn let go turns the page.
  bool lands({
    required double dx,
    required double from,
    required double velocity,
    required double width,
    required bool forward,
    required RitoPageTurnTouch? touch,
    required double? spine,
  }) {
    final numbers = _native.numbers..fillRange(0, ritoPaperTurnLayouts[2], 0);
    numbers.setAll(0, [dx, from, velocity, width, forward ? 1 : 0]);
    _writeTouch(numbers, 5, touch);
    if (spine != null) numbers.setAll(13, [1, spine]);
    return _native.lands();
  }

  /// Where a turn that cuts into another begins, and how fast.
  ({double dx, double velocity}) begins(
    double dx,
    double velocity, {
    required bool sameSpreads,
  }) {
    _native.begins(dx, velocity, sameSpreads);
    final numbers = _native.numbers;
    return (dx: numbers[0], velocity: numbers[1]);
  }

  /// How a turn nothing holds goes from [from] at [velocity] to [to].
  RitoPaperTurnSettle settle(double from, double velocity, double to) =>
      RitoPaperTurnSettle._(_native.settle(from, velocity, to));

  /// How high the eye is over a frame of this size.
  double eyeHeight(double width, double height) =>
      _native.eyeHeight(width, height);

  void dispose() => _native.dispose();

  List<int> _leaves() =>
      List<int>.of(_native.leaves.take(_native.leafCount), growable: false);

  static RitoPaperTurnPage? _page(Float64List numbers, int at) {
    if (numbers[at] != 1) return null;
    return RitoPaperTurnPage(
      spread: numbers[at + 1].toInt(),
      buffer: numbers[at + 2].toInt(),
    );
  }

  static RitoPaperTurnFace? _face(Float64List numbers, int at) {
    final kind = numbers[at];
    if (kind == 0) return null;
    return RitoPaperTurnFace(leaf: numbers[at + 1].toInt(), front: kind == 1);
  }
}

/// origin, position, then the farthest point (present, x, y): the touch of a
/// frame and of a release.
void _writeTouch(Float64List out, int at, RitoPageTurnTouch? touch) {
  if (touch == null) return;
  out.setAll(at, [
    1,
    touch.origin.dx,
    touch.origin.dy,
    touch.position.dx,
    touch.position.dy,
    1,
    touch.farthest.dx,
    touch.farthest.dy,
  ]);
}

void _writePage(Float64List out, int at, RitoPaperTurnPage? page) {
  if (page == null) return;
  out.setAll(at, [1, page.spread.toDouble(), page.buffer.toDouble()]);
}

/// A frame as `FrameInput::read` reads it.
void _writeFrame(RitoPaperTurnInput input, Float64List out) {
  out
    ..fillRange(0, out.length, 0)
    ..setAll(0, [
      input.width,
      input.height,
      input.spine,
      input.cssPixel,
      input.dx,
      switch (input.incoming) {
        RitoPageSlot.next => 1,
        RitoPageSlot.previous => 2,
        _ => 0,
      },
      switch (input.phase) {
        RitoPageTurnPhase.held => 0,
        RitoPageTurnPhase.landing => 1,
        RitoPageTurnPhase.returning => 2,
      },
    ]);
  _writeTouch(out, 7, input.touch);
  _writePage(out, 15, input.current);
  _writePage(out, 18, input.incomingPage);
  out[21] = input.now;
  out[22] = input.epoch.toDouble();
}
