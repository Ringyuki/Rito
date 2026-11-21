part of 'bindings.dart';

typedef _ControllerLayoutsNative =
    Uint32 Function(Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _ControllerNewNative =
    Uint32 Function(
      Pointer<Double>,
      Pointer<Uint64>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerHandleNative =
    Uint32 Function(Uint64, Pointer<_RitoOwnedBuffer>);
typedef _ControllerConfigureNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Uint32,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerPagesNative =
    Uint32 Function(Uint64, Pointer<Double>, Pointer<_RitoOwnedBuffer>);
typedef _ControllerFingerDownNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Double,
      Double,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerFingerMoveNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Double,
      Double,
      Double,
      Double,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerFingerUpNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Double,
      Double,
      Double,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerCommandNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Uint32,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerDirectionNative =
    Uint32 Function(Uint64, Pointer<Double>, Uint32, Pointer<_RitoOwnedBuffer>);
typedef _ControllerStepNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ControllerAnswerLandsNative =
    Uint32 Function(Uint64, Int32, Pointer<_RitoOwnedBuffer>);

@Native<_ControllerLayoutsNative>(
  symbol: 'rito_turn_controller_layouts',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerLayouts(
  Pointer<Uint32> layouts,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerNewNative>(
  symbol: 'rito_turn_controller_new',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerNew(
  Pointer<Double> physics,
  Pointer<Uint64> controller,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerHandleNative>(
  symbol: 'rito_turn_controller_free',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerFree(
  int controller,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerConfigureNative>(
  symbol: 'rito_turn_controller_configure',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerConfigure(
  int controller,
  Pointer<Double> physics,
  double width,
  int instant,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerFingerDownNative>(
  symbol: 'rito_turn_controller_finger_down',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerFingerDown(
  int controller,
  Pointer<Double> pages,
  double x,
  double y,
  double at,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerFingerMoveNative>(
  symbol: 'rito_turn_controller_finger_move',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerFingerMove(
  int controller,
  Pointer<Double> pages,
  double x,
  double y,
  double travel,
  double resisted,
  double at,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerFingerUpNative>(
  symbol: 'rito_turn_controller_finger_up',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerFingerUp(
  int controller,
  Pointer<Double> pages,
  double x,
  double y,
  double travel,
  double at,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_finger_cancel',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerFingerCancel(
  int controller,
  Pointer<Double> pages,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerCommandNative>(
  symbol: 'rito_turn_controller_command',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerCommand(
  int controller,
  Pointer<Double> pages,
  int direction,
  Pointer<Uint32> taken,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerDirectionNative>(
  symbol: 'rito_turn_controller_play_jump',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerPlayJump(
  int controller,
  Pointer<Double> pages,
  int direction,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerDirectionNative>(
  symbol: 'rito_turn_controller_landed',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerLanded(
  int controller,
  Pointer<Double> pages,
  int ok,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_pages',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerPages(
  int controller,
  Pointer<Double> pages,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_overdue',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerOverdue(
  int controller,
  Pointer<Double> pages,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerHandleNative>(
  symbol: 'rito_turn_controller_interrupt',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerInterrupt(
  int controller,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerStepNative>(
  symbol: 'rito_turn_controller_step',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerStep(
  int controller,
  Pointer<Double> pages,
  double seconds,
  Pointer<Double> hostAt,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_answer_begin',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerAnswerBegin(
  int controller,
  Pointer<Double> begin,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerAnswerLandsNative>(
  symbol: 'rito_turn_controller_answer_lands',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerAnswerLands(
  int controller,
  int lands,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_take_action',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerTakeAction(
  int controller,
  Pointer<Double> action,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_ControllerPagesNative>(
  symbol: 'rito_turn_controller_state',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoTurnControllerState(
  int controller,
  Pointer<Double> state,
  Pointer<_RitoOwnedBuffer> error,
);

/// How many numbers each of the turn controller's layouts is: pages,
/// action, state (`rito_ffi.h`).
const List<int> ritoTurnControllerLayouts = [8, 5, 40];

/// The engine's page turns of a reader through the C ABI, called on this
/// isolate. [pages] is where what the host knows of the pages is written
/// before each call; [physics] the built-in rules' numbers before
/// [configure]; [state] is the controller's state as of the last call,
/// [action] the last action taken.
final class RitoNativeTurnController {
  RitoNativeTurnController(List<double> physics) {
    _checkLayouts();
    this.physics.setAll(0, physics);
    final handle = calloc<Uint64>();
    try {
      RitoNativePaperTurn._throwOn(
        _ritoTurnControllerNew(_physics, handle, _error),
        _error,
      );
      _handle = handle.value;
    } finally {
      _ritoBufferFree(_error);
      calloc.free(handle);
    }
    _finalizer.attach(this, _handle, detach: this);
    _call((error) => _ritoTurnControllerState(_handle, _state, error));
  }

  static final _finalizer = Finalizer<int>((handle) {
    final error = calloc<_RitoOwnedBuffer>();
    _ritoTurnControllerFree(handle, error);
    _ritoBufferFree(error);
    calloc.free(error);
  });

  late final int _handle;
  final Pointer<_RitoOwnedBuffer> _error = calloc<_RitoOwnedBuffer>();
  final Pointer<Double> _physics = calloc<Double>(ritoTurnMotionLayouts[0]);
  final Pointer<Double> _pages = calloc<Double>(ritoTurnControllerLayouts[0]);
  final Pointer<Double> _action = calloc<Double>(ritoTurnControllerLayouts[1]);
  final Pointer<Double> _state = calloc<Double>(ritoTurnControllerLayouts[2]);
  final Pointer<Double> _at = calloc<Double>(ritoTurnMotionLayouts[2]);
  final Pointer<Double> _begin = calloc<Double>(2);
  final Pointer<Uint32> _answer = calloc<Uint32>();
  bool _disposed = false;

  Float64List get physics => _physics.asTypedList(ritoTurnMotionLayouts[0]);
  Float64List get pages => _pages.asTypedList(ritoTurnControllerLayouts[0]);
  Float64List get action => _action.asTypedList(ritoTurnControllerLayouts[1]);
  Float64List get state => _state.asTypedList(ritoTurnControllerLayouts[2]);

  static void _checkLayouts() {
    final layouts = calloc<Uint32>(ritoTurnControllerLayouts.length);
    final error = calloc<_RitoOwnedBuffer>();
    try {
      RitoNativePaperTurn._throwOn(
        _ritoTurnControllerLayouts(layouts, error),
        error,
      );
      final engine = layouts
          .asTypedList(ritoTurnControllerLayouts.length)
          .toList();
      if (engine.join(',') != ritoTurnControllerLayouts.join(',')) {
        throw StateError(
          "The engine's turn controller numbers are laid out $engine, "
          'not $ritoTurnControllerLayouts',
        );
      }
    } finally {
      _ritoBufferFree(error);
      calloc
        ..free(layouts)
        ..free(error);
    }
  }

  /// Makes [call], then reads the controller's state into [state].
  void _call(int Function(Pointer<_RitoOwnedBuffer> error) call) {
    if (_disposed) throw StateError('The turn controller has been disposed.');
    try {
      RitoNativePaperTurn._throwOn(call(_error), _error);
      RitoNativePaperTurn._throwOn(
        _ritoTurnControllerState(_handle, _state, _error),
        _error,
      );
    } finally {
      _ritoBufferFree(_error);
    }
  }

  void configure(double width, {required bool instant}) => _call(
    (error) => _ritoTurnControllerConfigure(
      _handle,
      _physics,
      width,
      instant ? 1 : 0,
      error,
    ),
  );

  void fingerDown(double x, double y, double at) => _call(
    (error) => _ritoTurnControllerFingerDown(_handle, _pages, x, y, at, error),
  );

  void fingerMove(
    double x,
    double y,
    double travel,
    double? resisted,
    double at,
  ) => _call(
    (error) => _ritoTurnControllerFingerMove(
      _handle,
      _pages,
      x,
      y,
      travel,
      resisted ?? double.nan,
      at,
      error,
    ),
  );

  void fingerUp(double x, double y, double travel, double at) => _call(
    (error) =>
        _ritoTurnControllerFingerUp(_handle, _pages, x, y, travel, at, error),
  );

  void fingerCancel() =>
      _call((error) => _ritoTurnControllerFingerCancel(_handle, _pages, error));

  /// 0 next, 1 previous; whether the command was taken.
  bool command(int direction) {
    _call(
      (error) => _ritoTurnControllerCommand(
        _handle,
        _pages,
        direction,
        _answer,
        error,
      ),
    );
    return _answer.value != 0;
  }

  void playJump(int direction) => _call(
    (error) => _ritoTurnControllerPlayJump(_handle, _pages, direction, error),
  );

  void landed({required bool ok}) => _call(
    (error) => _ritoTurnControllerLanded(_handle, _pages, ok ? 1 : 0, error),
  );

  void pagesChanged() =>
      _call((error) => _ritoTurnControllerPages(_handle, _pages, error));

  void overdue() =>
      _call((error) => _ritoTurnControllerOverdue(_handle, _pages, error));

  void interrupt() =>
      _call((error) => _ritoTurnControllerInterrupt(_handle, error));

  void step(double seconds, {({double x, double velocity, bool done})? host}) {
    if (host != null) {
      _at[0] = host.x;
      _at[1] = host.velocity;
      _at[2] = host.done ? 1 : 0;
    }
    _call(
      (error) => _ritoTurnControllerStep(
        _handle,
        _pages,
        seconds,
        host == null ? nullptr : _at,
        error,
      ),
    );
  }

  void answerBegin(({double offset, double velocity})? begin) {
    if (begin != null) {
      _begin[0] = begin.offset;
      _begin[1] = begin.velocity;
    }
    _call(
      (error) => _ritoTurnControllerAnswerBegin(
        _handle,
        begin == null ? nullptr : _begin,
        error,
      ),
    );
  }

  void answerLands(bool? lands) => _call(
    (error) => _ritoTurnControllerAnswerLands(
      _handle,
      lands == null ? -1 : (lands ? 1 : 0),
      error,
    ),
  );

  /// Takes the next action into [action]; false when there is none.
  bool takeAction() {
    _call((error) => _ritoTurnControllerTakeAction(_handle, _action, error));
    return _action[0] != 0;
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _finalizer.detach(this);
    _ritoTurnControllerFree(_handle, _error);
    _ritoBufferFree(_error);
    calloc
      ..free(_error)
      ..free(_physics)
      ..free(_pages)
      ..free(_action)
      ..free(_state)
      ..free(_at)
      ..free(_begin)
      ..free(_answer);
  }
}
