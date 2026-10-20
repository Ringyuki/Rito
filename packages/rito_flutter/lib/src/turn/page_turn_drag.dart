import 'package:flutter/gestures.dart';

/// How far a finger moves, either way, before it is a drag rather than a
/// tap, logical px: the web reader's.
const double _slop = 5;

/// The drag that turns a page, taken as the web reader takes one: by the
/// first finger down, a touch or a stylus (a mouse selects text instead),
/// once it has moved [_slop] px either way from where it came down — which
/// is where it took hold — every sample at its event's time. A finger
/// lifted before it moved that far is a tap, left to whatever wants taps.
/// One that moves that far across the way pages turn ([alongTheTurn]: up
/// or down the page, as pages turn) is no drag yet: it is followed from
/// where it is, and takes hold where it goes the way pages turn.
final class RitoPageTurnDragRecognizer extends OneSequenceGestureRecognizer {
  RitoPageTurnDragRecognizer({super.debugOwner})
    : super(
        supportedDevices: const {
          PointerDeviceKind.touch,
          PointerDeviceKind.stylus,
          PointerDeviceKind.invertedStylus,
        },
      );

  /// The finger came down at [down] and has moved far enough, at [at].
  void Function(Offset down, Duration at)? onStart;
  void Function(Offset position, Duration at)? onUpdate;

  /// The finger lifted at [position], at [at].
  void Function(Offset position, Duration at)? onEnd;

  /// The drag was taken away: another gesture won, or the pointer was cancelled.
  void Function()? onCancel;

  /// Whether a finger come down at `down` that has moved by `moved` moves
  /// along the way pages turn rather than across it; unset, a finger that
  /// moves more sideways than up or down does.
  bool Function(Offset down, Offset moved)? alongTheTurn;

  int? _pointer;
  Offset _down = Offset.zero;

  /// The move that took the finger past the slop, or the latest since.
  PointerMoveEvent? _moved;

  /// Whether the arena gave this recognizer the finger: at once when
  /// nothing else wants it, before it has moved at all.
  bool _won = false;

  /// Whether the drag has begun: the finger is past the slop and won.
  bool _accepted = false;

  @override
  void addAllowedPointer(PointerDownEvent event) {
    if (_pointer != null) return;
    super.addAllowedPointer(event);
    _pointer = event.pointer;
    _down = event.localPosition;
    _moved = null;
    _won = false;
    _accepted = false;
  }

  @override
  void handleEvent(PointerEvent event) {
    if (event.pointer != _pointer) return;
    if (event is PointerMoveEvent) {
      if (_accepted) {
        onUpdate?.call(event.localPosition, event.timeStamp);
        return;
      }
      final moved = event.localPosition - _down;
      if (_moved == null &&
          moved.dx.abs() <= _slop &&
          moved.dy.abs() <= _slop) {
        return;
      }
      if (_moved == null && !_along(moved)) {
        // Sliding across the way pages turn: followed from where it is.
        _down = event.localPosition;
        return;
      }
      _moved = event;
      if (_won) {
        _begin();
      } else {
        resolve(GestureDisposition.accepted);
      }
    } else if (event is PointerUpEvent) {
      if (_accepted) {
        onEnd?.call(event.localPosition, event.timeStamp);
      } else if (!_won) {
        resolve(GestureDisposition.rejected);
      }
      stopTrackingPointer(event.pointer);
    } else if (event is PointerCancelEvent) {
      if (_accepted) onCancel?.call();
      _accepted = false;
      stopTrackingPointer(event.pointer);
    }
  }

  @override
  void acceptGesture(int pointer) {
    if (pointer != _pointer) return;
    _won = true;
    // Given the finger before it moved: a drag only once it has.
    if (_moved != null) _begin();
  }

  bool _along(Offset moved) =>
      alongTheTurn?.call(_down, moved) ?? moved.dx.abs() >= moved.dy.abs();

  void _begin() {
    final moved = _moved;
    if (_accepted || moved == null) return;
    _accepted = true;
    onStart?.call(_down, moved.timeStamp);
    onUpdate?.call(moved.localPosition, moved.timeStamp);
  }

  @override
  void rejectGesture(int pointer) {
    if (pointer != _pointer) return;
    if (_accepted) onCancel?.call();
    _accepted = false;
    stopTrackingPointer(pointer);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {
    _pointer = null;
    _moved = null;
    _won = false;
    _accepted = false;
  }

  @override
  String get debugDescription => 'page turn drag';
}
