part of 'bindings.dart';

typedef _TurnLayoutsNative =
    Uint32 Function(Pointer<Uint32>, Pointer<_RitoOwnedBuffer>);
typedef _TurnNewNative =
    Uint32 Function(Pointer<Uint64>, Pointer<_RitoOwnedBuffer>);
typedef _TurnFreeNative = Uint32 Function(Uint64, Pointer<_RitoOwnedBuffer>);
typedef _TurnBeginNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Pointer<Double>,
      Pointer<Uint32>,
      Uint32,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnLayNative =
    Uint32 Function(
      Uint64,
      Uint64,
      Pointer<Double>,
      Pointer<Uint32>,
      Uint32,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnSheetNative =
    Uint32 Function(
      Uint64,
      Uint32,
      Pointer<Double>,
      Pointer<Float>,
      Pointer<Float>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnForgetNative =
    Uint32 Function(
      Uint64,
      Uint64,
      Pointer<Uint32>,
      Pointer<Uint32>,
      Uint32,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnStateNative =
    Uint32 Function(Uint64, Double, Pointer<Double>, Pointer<_RitoOwnedBuffer>);
typedef _TurnBeginsNative =
    Uint32 Function(
      Uint64,
      Double,
      Double,
      Uint32,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnSettleNative =
    Uint32 Function(
      Uint64,
      Double,
      Double,
      Double,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnSettleStepNative =
    Uint32 Function(
      Uint64,
      Pointer<Double>,
      Double,
      Double,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnTravelNative =
    Uint32 Function(
      Pointer<Double>,
      Double,
      Double,
      Pointer<Double>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnLandsNative =
    Uint32 Function(
      Pointer<Double>,
      Pointer<Uint32>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _TurnEyeHeightNative =
    Uint32 Function(Double, Double, Pointer<Double>, Pointer<_RitoOwnedBuffer>);

@Native<_TurnLayoutsNative>(
  symbol: 'rito_paper_turn_layouts',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnLayouts(
  Pointer<Uint32> layouts,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnNewNative>(
  symbol: 'rito_paper_turn_new',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnNew(
  Pointer<Uint64> turn,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnFreeNative>(
  symbol: 'rito_paper_turn_free',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnFree(int turn, Pointer<_RitoOwnedBuffer> error);

@Native<_TurnBeginNative>(
  symbol: 'rito_paper_turn_begin',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnBegin(
  int turn,
  Pointer<Double> frame,
  Pointer<Double> begun,
  Pointer<Uint32> leaves,
  int capacity,
  Pointer<Uint32> count,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnLayNative>(
  symbol: 'rito_paper_turn_lay',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnLay(
  int turn,
  int epoch,
  Pointer<Double> laid,
  Pointer<Uint32> leaves,
  int capacity,
  Pointer<Uint32> count,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnSheetNative>(
  symbol: 'rito_paper_turn_sheet',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnSheet(
  int turn,
  int index,
  Pointer<Double> sheet,
  Pointer<Float> positions,
  Pointer<Float> normals,
  int capacity,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnForgetNative>(
  symbol: 'rito_paper_turn_forget',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnForget(
  int turn,
  int epoch,
  Pointer<Uint32> release,
  Pointer<Uint32> leaves,
  int capacity,
  Pointer<Uint32> count,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnStateNative>(
  symbol: 'rito_paper_turn_state',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnState(
  int turn,
  double now,
  Pointer<Double> state,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnBeginsNative>(
  symbol: 'rito_paper_turn_begins',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnBegins(
  int turn,
  double dx,
  double velocity,
  int sameSpreads,
  Pointer<Double> begins,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnSettleNative>(
  symbol: 'rito_paper_turn_settle',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnSettle(
  int turn,
  double from,
  double velocity,
  double to,
  Pointer<Double> settle,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnSettleStepNative>(
  symbol: 'rito_paper_turn_settle_step',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnSettleStep(
  int turn,
  Pointer<Double> settle,
  double seconds,
  double now,
  Pointer<Double> at,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnTravelNative>(
  symbol: 'rito_paper_turn_travel',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnTravel(
  Pointer<Double> touch,
  double width,
  double spine,
  Pointer<Double> travel,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnLandsNative>(
  symbol: 'rito_paper_turn_lands',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnLands(
  Pointer<Double> release,
  Pointer<Uint32> lands,
  Pointer<_RitoOwnedBuffer> error,
);

@Native<_TurnEyeHeightNative>(
  symbol: 'rito_paper_turn_eye_height',
  assetId: ritoNativeAssetId,
  isLeaf: true,
)
external int _ritoPaperTurnEyeHeight(
  double width,
  double height,
  Pointer<Double> eye,
  Pointer<_RitoOwnedBuffer> error,
);

/// How many numbers each of the paper turn's layouts is: frame, sheet,
/// release, settle, begun, laid, state (`rito_ffi.h`).
const List<int> ritoPaperTurnLayouts = [23, 11, 15, 12, 4, 11, 4];

/// The most leaves a call names: more than the book ever holds in the air.
const int _leavesAtMost = 32;

/// Native arrays of a sheet's points, x, y, z each, that a model copies
/// into: views over them stay valid until [dispose].
final class RitoNativePaperTurnPoints {
  RitoNativePaperTurnPoints(this.length)
    : _positions = calloc<Float>(length),
      _normals = calloc<Float>(length);

  final int length;
  final Pointer<Float> _positions;
  final Pointer<Float> _normals;

  Float32List get positions => _positions.asTypedList(length);
  Float32List get normals => _normals.asTypedList(length);

  void dispose() {
    calloc
      ..free(_positions)
      ..free(_normals);
  }
}

/// A settle the host holds and steps once a frame.
final class RitoNativePaperTurnSettle {
  RitoNativePaperTurnSettle._(this._turn)
    : _state = calloc<Double>(ritoPaperTurnLayouts[3]),
      _at = calloc<Double>(3);

  final RitoNativePaperTurn _turn;
  final Pointer<Double> _state;
  final Pointer<Double> _at;

  /// Steps to [seconds] after it began, at [now] (ms): x, velocity, done (1/0).
  Float64List step(double seconds, double now) {
    _turn._call(
      (error) => _ritoPaperTurnSettleStep(
        _turn._handle,
        _state,
        seconds,
        now,
        _at,
        error,
      ),
    );
    return _at.asTypedList(3);
  }

  void dispose() {
    calloc
      ..free(_state)
      ..free(_at);
  }
}

/// The paper page turn's model through the C ABI, called on this isolate.
/// A frame's numbers are written into [frame] and read by [begin]; what a
/// call answers is in the arrays named for it, valid until the next call.
final class RitoNativePaperTurn {
  RitoNativePaperTurn() {
    _checkLayouts();
    final handle = calloc<Uint64>();
    try {
      _call((error) => _ritoPaperTurnNew(handle, error));
      _handle = handle.value;
    } finally {
      calloc.free(handle);
    }
  }

  late final int _handle;
  final Pointer<_RitoOwnedBuffer> _error = calloc<_RitoOwnedBuffer>();
  final Pointer<Double> _frame = calloc<Double>(ritoPaperTurnLayouts[0]);
  final Pointer<Double> _begun = calloc<Double>(ritoPaperTurnLayouts[4]);
  final Pointer<Double> _laid = calloc<Double>(ritoPaperTurnLayouts[5]);
  final Pointer<Double> _sheet = calloc<Double>(ritoPaperTurnLayouts[1]);
  final Pointer<Double> _state = calloc<Double>(ritoPaperTurnLayouts[6]);
  final Pointer<Double> _numbers = calloc<Double>(ritoPaperTurnLayouts[2]);
  final Pointer<Double> _answer = calloc<Double>();
  final Pointer<Uint32> _leaves = calloc<Uint32>(_leavesAtMost);
  final Pointer<Uint32> _count = calloc<Uint32>();
  bool _disposed = false;

  Float64List get frame => _frame.asTypedList(ritoPaperTurnLayouts[0]);
  Float64List get begun => _begun.asTypedList(ritoPaperTurnLayouts[4]);
  Float64List get laid => _laid.asTypedList(ritoPaperTurnLayouts[5]);
  Float64List get sheetNumbers => _sheet.asTypedList(ritoPaperTurnLayouts[1]);
  Float64List get state => _state.asTypedList(ritoPaperTurnLayouts[6]);

  /// The numbers a release, a touch or a pair of answers is laid out in.
  Float64List get numbers => _numbers.asTypedList(ritoPaperTurnLayouts[2]);

  /// The leaves the last call named, [leafCount] of them.
  Uint32List get leaves => _leaves.asTypedList(_leavesAtMost);
  int get leafCount => _count.value;

  static void _checkLayouts() {
    final layouts = calloc<Uint32>(ritoPaperTurnLayouts.length);
    final error = calloc<_RitoOwnedBuffer>();
    try {
      _throwOn(_ritoPaperTurnLayouts(layouts, error), error);
      final engine = layouts.asTypedList(ritoPaperTurnLayouts.length).toList();
      if (engine.join(',') != ritoPaperTurnLayouts.join(',')) {
        throw StateError(
          "The engine's paper turn numbers are laid out $engine, "
          'not $ritoPaperTurnLayouts',
        );
      }
    } finally {
      _ritoBufferFree(error);
      calloc
        ..free(layouts)
        ..free(error);
    }
  }

  static void _throwOn(int status, Pointer<_RitoOwnedBuffer> error) {
    if (status == 0) return;
    final length = error.ref.length;
    final bytes = length == 0
        ? Uint8List(0)
        : Uint8List.fromList(error.ref.data.asTypedList(length));
    throw RitoNativeException(
      status: status,
      message: bytes.isEmpty
          ? 'Rito native call failed without a diagnostic.'
          : utf8.decode(bytes, allowMalformed: true),
    );
  }

  void _call(int Function(Pointer<_RitoOwnedBuffer> error) call) {
    if (_disposed) throw StateError('The paper turn has been disposed.');
    try {
      _throwOn(call(_error), _error);
    } finally {
      _ritoBufferFree(_error);
    }
  }

  /// Reads [frame]: [begun] says what it found, [leaves] the leaves forgotten.
  void begin() => _call(
    (error) => _ritoPaperTurnBegin(
      _handle,
      _frame,
      _begun,
      _leaves,
      _leavesAtMost,
      _count,
      error,
    ),
  );

  /// Lays out the frame [begin] read: [laid] describes it, [leaves] the
  /// leaves that left the book.
  void lay(int epoch) => _call(
    (error) => _ritoPaperTurnLay(
      _handle,
      epoch,
      _laid,
      _leaves,
      _leavesAtMost,
      _count,
      error,
    ),
  );

  /// Describes sheet [index] in [sheetNumbers], and copies its points into
  /// [into] where given.
  void sheet(int index, [RitoNativePaperTurnPoints? into]) => _call(
    (error) => _ritoPaperTurnSheet(
      _handle,
      index,
      _sheet,
      into?._positions ?? nullptr,
      into?._normals ?? nullptr,
      into?.length ?? 0,
      error,
    ),
  );

  /// Forgets the leaves in the air, naming them in [leaves]; true when their
  /// pages are the host's to let go.
  bool forget(int epoch) {
    final release = calloc<Uint32>();
    try {
      _call(
        (error) => _ritoPaperTurnForget(
          _handle,
          epoch,
          release,
          _leaves,
          _leavesAtMost,
          _count,
          error,
        ),
      );
      return release.value != 0;
    } finally {
      calloc.free(release);
    }
  }

  /// Fills [state] at [now] (ms): painted, there, gone, aloft.
  void readState(double now) =>
      _call((error) => _ritoPaperTurnState(_handle, now, _state, error));

  /// Where a turn that cuts into another begins and how fast: [numbers] 0 and 1.
  void begins(double dx, double velocity, bool sameSpreads) => _call(
    (error) => _ritoPaperTurnBegins(
      _handle,
      dx,
      velocity,
      sameSpreads ? 1 : 0,
      _numbers,
      error,
    ),
  );

  RitoNativePaperTurnSettle settle(double from, double velocity, double to) {
    final settle = RitoNativePaperTurnSettle._(this);
    _call(
      (error) => _ritoPaperTurnSettle(
        _handle,
        from,
        velocity,
        to,
        settle._state,
        error,
      ),
    );
    return settle;
  }

  /// How far a finger has carried a turn; [numbers] 0–3 hold its origin
  /// x, y and position x, y.
  double travel(double width, double spine) {
    _call(
      (error) => _ritoPaperTurnTravel(_numbers, width, spine, _answer, error),
    );
    return _answer.value;
  }

  /// Whether the release laid out in [numbers] turns the page.
  bool lands() {
    final lands = calloc<Uint32>();
    try {
      _call((error) => _ritoPaperTurnLands(_numbers, lands, error));
      return lands.value != 0;
    } finally {
      calloc.free(lands);
    }
  }

  double eyeHeight(double width, double height) {
    _call((error) => _ritoPaperTurnEyeHeight(width, height, _answer, error));
    return _answer.value;
  }

  void dispose() {
    if (_disposed) return;
    _call((error) => _ritoPaperTurnFree(_handle, error));
    _disposed = true;
    calloc
      ..free(_error)
      ..free(_frame)
      ..free(_begun)
      ..free(_laid)
      ..free(_sheet)
      ..free(_state)
      ..free(_numbers)
      ..free(_answer)
      ..free(_leaves)
      ..free(_count);
  }
}
