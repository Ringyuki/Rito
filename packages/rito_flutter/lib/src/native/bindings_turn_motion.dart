part of 'bindings.dart';

typedef _MotionLayoutsNative =
    Uint32 Function(Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _MotionNewNative =
    Uint32 Function(
      Pointer<Double>,
      Pointer<Uint64>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _MotionHandleNative =
    Uint32 Function(Uint64, Pointer<_RitoOwnedBuffer>);
typedef _MotionConfigureNative =
    Uint32 Function(Uint64, Pointer<Double>, Double, Pointer<_RitoOwnedBuffer>);
typedef _MotionStartDragNative =
    Uint32 Function(
      Uint64,
      Uint32,
      Uint32,
      Double,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _MotionDragNative =
    Uint32 Function(Uint64, Double, Double, Uint32, Pointer<_RitoOwnedBuffer>);
typedef _MotionReleaseNative =
    Uint32 Function(Uint64, Int32, Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _MotionAnswerNative =
    Uint32 Function(Uint64, Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _MotionTurnNative =
    Uint32 Function(Uint64, Uint32, Pointer<Double>, Pointer<_RitoOwnedBuffer>);
typedef _MotionInterruptNative =
    Uint32 Function(Uint64, Double, Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _MotionCarryOnNative =
    Uint32 Function(Uint64, Uint32, Pointer<_RitoOwnedBuffer>);
typedef _MotionStepNative =
    Uint32 Function(
      Uint64,
      Double,
      Pointer<Double>,
      Uint32,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _MotionStateNative =
    Uint32 Function(Uint64, Pointer<Double>, Pointer<_RitoOwnedBuffer>);

@Native<_MotionLayoutsNative>(
  symbol: 'rito_turn_motion_layouts',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionLayouts(
  Pointer<Uint32> layouts,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionNewNative>(
  symbol: 'rito_turn_motion_new',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionNew(
  Pointer<Double> physics,
  Pointer<Uint64> motion,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionHandleNative>(
  symbol: 'rito_turn_motion_free',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionFree(int motion, Pointer<_RitoOwnedBuffer> error);

@Native<_MotionConfigureNative>(
  symbol: 'rito_turn_motion_configure',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionConfigure(
  int motion,
  Pointer<Double> physics,
  double width,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionStartDragNative>(
  symbol: 'rito_turn_motion_start_drag',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionStartDrag(
  int motion,
  int forward,
  int hasIncoming,
  double at,
  Pointer<Double> begin,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionDragNative>(
  symbol: 'rito_turn_motion_drag',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionDrag(
  int motion,
  double travel,
  double at,
  int carried,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionReleaseNative>(
  symbol: 'rito_turn_motion_release',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionRelease(
  int motion,
  int lands,
  Pointer<Uint32> landsOut,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionAnswerNative>(
  symbol: 'rito_turn_motion_cancel',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionCancel(
  int motion,
  Pointer<Uint32> cancelled,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionTurnNative>(
  symbol: 'rito_turn_motion_turn',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionTurn(
  int motion,
  int forward,
  Pointer<Double> begin,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionInterruptNative>(
  symbol: 'rito_turn_motion_interrupt',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionInterrupt(
  int motion,
  double at,
  Pointer<Uint32> interrupted,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionCarryOnNative>(
  symbol: 'rito_turn_motion_carry_on',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionCarryOn(
  int motion,
  int committed,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionStepNative>(
  symbol: 'rito_turn_motion_step',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionStep(
  int motion,
  double seconds,
  Pointer<Double> hostAt,
  int instant,
  Pointer<Uint32> step,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_MotionHandleNative>(
  symbol: 'rito_turn_motion_finish',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionFinish(int motion, Pointer<_RitoOwnedBuffer> error);

@Native<_MotionHandleNative>(
  symbol: 'rito_turn_motion_reset',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionReset(int motion, Pointer<_RitoOwnedBuffer> error);

@Native<_MotionStateNative>(
  symbol: 'rito_turn_motion_state',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnMotionState(
  int motion,
  Pointer<Double> state,
  Pointer<_RitoOwnedBuffer> error,
);

/// How many numbers each of the turn motion's layouts is: physics, state,
/// a place (`rito_ffi.h`).
const List<int> ritoTurnMotionLayouts = [7, 19, 3];

/// The engine's motion of a page turn through the C ABI, called on this
/// isolate. [physics] is where the built-in rules' numbers are written
/// before [configure]; [state] is the motion's state as of the last call.
final class RitoNativeTurnMotion {
  RitoNativeTurnMotion(List<double> physics) {
    _checkLayouts();
    this.physics.setAll(0, physics);
    final handle = calloc<Uint64>();
    try {
      RitoNativePaperTurn._throwOn(
        _ritoTurnMotionNew(_physics, handle, _error),
        _error,
      );
      _handle = handle.value;
    } finally {
      _ritoBufferFree(_error);
      calloc.free(handle);
    }
    _finalizer.attach(this, _handle, detach: this);
    _call((error) => _ritoTurnMotionState(_handle, _state, error));
  }

  static final _finalizer = Finalizer<int>((handle) {
    final error = calloc<_RitoOwnedBuffer>();
    _ritoTurnMotionFree(handle, error);
    _ritoBufferFree(error);
    calloc.free(error);
  });

  late final int _handle;
  final Pointer<_RitoOwnedBuffer> _error = calloc<_RitoOwnedBuffer>();
  final Pointer<Double> _physics = calloc<Double>(ritoTurnMotionLayouts[0]);
  final Pointer<Double> _state = calloc<Double>(ritoTurnMotionLayouts[1]);
  final Pointer<Double> _at = calloc<Double>(ritoTurnMotionLayouts[2]);
  final Pointer<Double> _begin = calloc<Double>(2);
  final Pointer<Uint32> _answer = calloc<Uint32>();
  bool _disposed = false;

  Float64List get physics => _physics.asTypedList(ritoTurnMotionLayouts[0]);
  Float64List get state => _state.asTypedList(ritoTurnMotionLayouts[1]);

  static void _checkLayouts() {
    final layouts = calloc<Uint32>(ritoTurnMotionLayouts.length);
    final error = calloc<_RitoOwnedBuffer>();
    try {
      RitoNativePaperTurn._throwOn(
        _ritoTurnMotionLayouts(layouts, error),
        error,
      );
      final engine = layouts.asTypedList(ritoTurnMotionLayouts.length).toList();
      if (engine.join(',') != ritoTurnMotionLayouts.join(',')) {
        throw StateError(
          "The engine's turn motion numbers are laid out $engine, "
          'not $ritoTurnMotionLayouts',
        );
      }
    } finally {
      _ritoBufferFree(error);
      calloc
        ..free(layouts)
        ..free(error);
    }
  }

  /// Makes [call], then reads the motion's state into [state].
  void _call(int Function(Pointer<_RitoOwnedBuffer> error) call) {
    if (_disposed) throw StateError('The turn motion has been disposed.');
    try {
      RitoNativePaperTurn._throwOn(call(_error), _error);
      RitoNativePaperTurn._throwOn(
        _ritoTurnMotionState(_handle, _state, _error),
        _error,
      );
    } finally {
      _ritoBufferFree(_error);
    }
  }

  Pointer<Double> _beginOf(({double offset, double velocity})? begin) {
    if (begin == null) return nullptr;
    _begin[0] = begin.offset;
    _begin[1] = begin.velocity;
    return _begin;
  }

  /// Tells the motion [physics] and the width a turn travels.
  void configure(double width) => _call(
    (error) => _ritoTurnMotionConfigure(_handle, _physics, width, error),
  );

  void startDrag({
    required bool forward,
    required bool hasIncoming,
    required double at,
    ({double offset, double velocity})? begin,
  }) => _call(
    (error) => _ritoTurnMotionStartDrag(
      _handle,
      forward ? 1 : 0,
      hasIncoming ? 1 : 0,
      at,
      _beginOf(begin),
      error,
    ),
  );

  /// Follows the finger: [travel] px, or, with [carried], the turn the
  /// host's physics made of it.
  void drag(double travel, {required double at, bool carried = false}) => _call(
    (error) => _ritoTurnMotionDrag(_handle, travel, at, carried ? 1 : 0, error),
  );

  /// Lets go; [lands] is the host's physics' answer, null for the engine's.
  bool release(bool? lands) {
    final decided = lands == null ? -1 : (lands ? 1 : 0);
    _call((error) => _ritoTurnMotionRelease(_handle, decided, _answer, error));
    return _answer.value != 0;
  }

  bool cancel() {
    _call((error) => _ritoTurnMotionCancel(_handle, _answer, error));
    return _answer.value != 0;
  }

  void turn({
    required bool forward,
    ({double offset, double velocity})? begin,
  }) => _call(
    (error) =>
        _ritoTurnMotionTurn(_handle, forward ? 1 : 0, _beginOf(begin), error),
  );

  bool interrupt(double at) {
    _call((error) => _ritoTurnMotionInterrupt(_handle, at, _answer, error));
    return _answer.value != 0;
  }

  void carryOn({required bool committed}) => _call(
    (error) => _ritoTurnMotionCarryOn(_handle, committed ? 1 : 0, error),
  );

  /// Moves the turn on; [host] is where the host's motion is then, while it
  /// carries one, from its first step (null leaves it to the spring). What
  /// the step did (`rito_turn::turn_pack::turn_step_code`).
  int step(
    double seconds, {
    ({double x, double velocity, bool done})? host,
    bool instant = false,
  }) {
    if (host != null) {
      _at[0] = host.x;
      _at[1] = host.velocity;
      _at[2] = host.done ? 1 : 0;
    }
    _call(
      (error) => _ritoTurnMotionStep(
        _handle,
        seconds,
        host == null ? nullptr : _at,
        instant ? 1 : 0,
        _answer,
        error,
      ),
    );
    return _answer.value;
  }

  void finish() => _call((error) => _ritoTurnMotionFinish(_handle, error));

  void reset() => _call((error) => _ritoTurnMotionReset(_handle, error));

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _finalizer.detach(this);
    _ritoTurnMotionFree(_handle, _error);
    _ritoBufferFree(_error);
    calloc
      ..free(_error)
      ..free(_physics)
      ..free(_state)
      ..free(_at)
      ..free(_begin)
      ..free(_answer);
  }
}
