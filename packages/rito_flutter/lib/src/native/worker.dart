part of 'gateway.dart';

final class _RitoWorkerClient {
  _RitoWorkerClient(this._commands, this._isolate, this._signals);

  static Future<_RitoWorkerClient> start(
    RitoDynamicLibrarySource? diagnosticLibrary,
  ) async {
    final ready = ReceivePort();
    final signals = _WorkerSignals();
    Isolate? isolate;
    try {
      isolate = await Isolate.spawn(
        _workerMain,
        _WorkerBootstrap(diagnosticLibrary, ready.sendPort),
        debugName: 'rito-flutter-native',
        onError: signals.errorSendPort,
        onExit: signals.exitSendPort,
      );
      final readyMessage = await signals.latch.race<Object?>(
        ready.first,
        action: 'initialization',
      );
      if (readyMessage case _WorkerResult(:final error?, :final stackTrace?)) {
        Error.throwWithStackTrace(error, stackTrace);
      }
      if (readyMessage is! SendPort) {
        throw StateError(
          'Rito native worker returned an invalid ready signal.',
        );
      }
      return _RitoWorkerClient(readyMessage, isolate, signals);
    } on Object {
      isolate?.kill(priority: Isolate.immediate);
      await signals.dispose();
      rethrow;
    } finally {
      ready.close();
    }
  }

  final SendPort _commands;
  final Isolate _isolate;
  final _WorkerSignals _signals;
  final RitoWorkerCloseGate _closeGate = RitoWorkerCloseGate();

  Future<T> invoke<T>(_WorkerOperation operation) async {
    final result = await _invoke(operation);
    return result.value as T;
  }

  Future<Uint8List> invokeWire(_WorkerOperation operation) async {
    final result = await _invoke(operation);
    final transfer = result.value! as TransferableTypedData;
    return RitoOwnedByteTransfer.materialize(transfer);
  }

  Future<_WorkerResult> _invoke(_WorkerOperation operation) async {
    if (_closeGate.operationsClosed) {
      throw StateError('Rito native worker is closed.');
    }
    final reply = ReceivePort();
    late final Object? message;
    try {
      _commands.send(_WorkerEnvelope(operation, reply.sendPort));
      message = await _signals.latch.race<Object?>(
        reply.first,
        action: 'native operation',
      );
    } finally {
      reply.close();
    }
    if (message is! _WorkerResult) {
      throw StateError('Rito native worker returned an invalid reply.');
    }
    final result = message;
    if (result.error != null) {
      Error.throwWithStackTrace(
        result.error!,
        result.stackTrace ?? StackTrace.current,
      );
    }
    return result;
  }

  Future<void> close() {
    return _closeGate.run(_closeAttempt);
  }

  Future<void> _closeAttempt() async {
    final reply = ReceivePort();
    _signals.latch.beginClose();
    late final Object? message;
    try {
      _commands.send(_WorkerEnvelope(const _CloseOperation(), reply.sendPort));
      message = await _signals.latch.race<Object?>(
        reply.first,
        action: 'close acknowledgement',
      );
    } on RitoNativeWorkerTerminatedException {
      await _reclaimTransport();
      rethrow;
    } finally {
      reply.close();
    }
    if (message is! _WorkerResult) {
      throw StateError('Rito native worker returned an invalid close reply.');
    }
    final result = message;
    if (result.error != null) {
      Error.throwWithStackTrace(
        result.error!,
        result.stackTrace ?? StackTrace.current,
      );
    }

    _commands.send(const _WorkerStop());
    try {
      await _signals.latch.waitForExit();
    } finally {
      await _reclaimTransport();
    }
  }

  Future<void> _reclaimTransport() async {
    _isolate.kill(priority: Isolate.immediate);
    await _signals.dispose();
  }
}

final class _WorkerSignals {
  _WorkerSignals() {
    _arbiter = RitoWorkerSignalArbiter(latch: latch, onSettled: _stopListening);
    _exitSubscription = _exit.cast<Object?>().listen((_) {
      _arbiter.reportExit();
    });
    _errorSubscription = _errors.cast<Object?>().listen((message) {
      _arbiter.reportError(message);
    });
  }

  final ReceivePort _exit = ReceivePort();
  final ReceivePort _errors = ReceivePort();
  final RitoWorkerFailureLatch latch = RitoWorkerFailureLatch();
  late final RitoWorkerSignalArbiter _arbiter;
  late final StreamSubscription<Object?> _exitSubscription;
  late final StreamSubscription<Object?> _errorSubscription;
  Future<void>? _disposeFuture;
  bool _listening = true;

  SendPort get exitSendPort => _exit.sendPort;
  SendPort get errorSendPort => _errors.sendPort;

  Future<void> dispose() {
    final existing = _disposeFuture;
    if (existing != null) {
      return existing;
    }
    _arbiter.dispose();
    _stopListening();
    final future = Future.wait<void>(<Future<void>>[
      _exitSubscription.cancel(),
      _errorSubscription.cancel(),
    ]);
    _disposeFuture = future;
    return future;
  }

  void _stopListening() {
    if (!_listening) {
      return;
    }
    _listening = false;
    _exit.close();
    _errors.close();
  }
}

void _workerMain(_WorkerBootstrap bootstrap) {
  final commands = ReceivePort();
  final liveSessions = <int>{};
  late final RitoNativeWireBindings bindings;
  try {
    bindings = switch (bootstrap.diagnosticLibrary) {
      null => RitoNativeWireBindings(),
      final library => RitoNativeWireBindings.fromDynamicLibrary(
        library.open(),
      ),
    };
  } on Object catch (error, stackTrace) {
    bootstrap.ready.send(_WorkerResult(error: error, stackTrace: stackTrace));
    commands.close();
    return;
  }
  bootstrap.ready.send(commands.sendPort);
  commands.listen((Object? message) {
    if (message is _WorkerStop) {
      commands.close();
      return;
    }
    final envelope = message! as _WorkerEnvelope;
    try {
      final value = _perform(bindings, envelope.operation, liveSessions);
      envelope.reply.send(
        _WorkerResult(
          value: _prepareReply(
            bindings,
            envelope.operation,
            value,
            liveSessions,
          ),
        ),
      );
    } on Object catch (error, stackTrace) {
      envelope.reply.send(_WorkerResult(error: error, stackTrace: stackTrace));
    }
  });
}

Object? _prepareReply(
  RitoNativeWireBindings bindings,
  _WorkerOperation operation,
  Object? value,
  Set<int> liveSessions,
) {
  if (value is! Uint8List) {
    return value;
  }
  try {
    return RitoOwnedByteTransfer.take(value);
  } on Object {
    _discardUnsentWire(bindings, operation, value, liveSessions);
    rethrow;
  }
}

void _discardUnsentWire(
  RitoNativeWireBindings bindings,
  _WorkerOperation operation,
  Uint8List wireBytes,
  Set<int> liveSessions,
) {
  try {
    switch (operation) {
      case _OpenOperation():
        bindings.dispose(sessionId: operation.sessionId);
        liveSessions.remove(operation.sessionId);
        break;
      case _RequestArtifactOperation():
        final artifactId = _wireArtifactId(wireBytes);
        if (artifactId != null) {
          bindings.releaseArtifact(
            sessionId: operation.sessionId,
            artifactId: artifactId,
          );
        }
        break;
      case _RequestAdjacentOperation():
        final artifactId = _wireArtifactId(wireBytes);
        if (artifactId != null) {
          bindings.releaseArtifact(
            sessionId: operation.sessionId,
            artifactId: artifactId,
          );
        }
        break;
      case _PeekAdjacentOperation():
        final artifactId = _wireArtifactId(wireBytes);
        if (artifactId != null) {
          bindings.releaseArtifact(
            sessionId: operation.sessionId,
            artifactId: artifactId,
          );
        }
        break;
      case _AdvanceBackgroundOperation():
        // The reply either carries a host-owned candidate or confirms a
        // visibility mutation. If transfer fails, only session disposal can
        // re-establish an ownership state the host can prove.
        bindings.dispose(sessionId: operation.sessionId);
        liveSessions.remove(operation.sessionId);
        break;
      case _AdoptForegroundOperation():
        bindings.dispose(sessionId: operation.sessionId);
        liveSessions.remove(operation.sessionId);
        break;
      case _CommitPeekedOperation():
        // The commit may already have swapped visibility; a lost ack
        // leaves ownership unprovable, so only disposal recovers.
        bindings.dispose(sessionId: operation.sessionId);
        liveSessions.remove(operation.sessionId);
        break;
      case _AdoptBackgroundOperation():
        bindings.dispose(sessionId: operation.sessionId);
        liveSessions.remove(operation.sessionId);
        break;
      case _ReadPublicationOperation():
      case _ReadResourceOperation():
      case _SearchOperation():
      case _TextRangeGeometryOperation():
      case _ReadFootnoteOperation():
      case _ReleaseArtifactOperation():
      case _DisposeOperation():
      case _CloseOperation():
        break;
    }
  } on Object {
    // Preserve the ownership-transfer failure as the primary diagnostic.
  }
}

int? _wireArtifactId(Uint8List wireBytes) {
  if (wireBytes.length < 64) {
    return null;
  }
  final value = ByteData.sublistView(
    wireBytes,
    56,
    64,
  ).getUint64(0, Endian.little);
  return value > 0 && value <= 0x7fffffffffffffff ? value : null;
}

Object? _perform(
  RitoNativeWireBindings bindings,
  _WorkerOperation operation,
  Set<int> liveSessions,
) {
  return switch (operation) {
    _OpenOperation() => _open(bindings, operation, liveSessions),
    _RequestArtifactOperation() => bindings.requestArtifactEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _RequestAdjacentOperation() => bindings.requestAdjacentEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _PeekAdjacentOperation() => bindings.peekAdjacentEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _CommitPeekedOperation() => bindings.commitPeekedArtifactEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadPublicationOperation() => bindings.readPublicationEncoded(
      sessionId: operation.sessionId,
    ),
    _AdoptForegroundOperation() => bindings.adoptForegroundCandidateEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _AdvanceBackgroundOperation() => bindings.advanceBackgroundEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _AdoptBackgroundOperation() => bindings.adoptBackgroundCandidateEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadResourceOperation() => bindings.readResource(
      sessionId: operation.sessionId,
      artifactId: operation.artifactId,
      kind: operation.kind,
      href: operation.href,
    ),
    _SearchOperation() => bindings.searchEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _TextRangeGeometryOperation() => bindings.textRangeGeometryEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadFootnoteOperation() => bindings.readFootnote(
      sessionId: operation.sessionId,
      artifactId: operation.artifactId,
      key: operation.key,
    ),
    _ReleaseArtifactOperation() => _release(bindings, operation),
    _DisposeOperation() => _dispose(bindings, operation, liveSessions),
    _CloseOperation() => _disposeAll(bindings, liveSessions),
  };
}

Uint8List _open(
  RitoNativeWireBindings bindings,
  _OpenOperation operation,
  Set<int> liveSessions,
) {
  try {
    final faces = operation.pinnedFontFaces;
    final wireBytes = bindings.openEncoded(
      publicationBytes: RitoOwnedByteTransfer.materialize(
        operation.publicationBytes,
      ),
      requestBytes: operation.requestBytes,
      pinnedFontPolicy: faces == null
          ? null
          : RitoPinnedFontPolicy(
              faces: <RitoPinnedFontFace>[
                for (final face in faces)
                  RitoPinnedFontFace(
                    bytes: RitoOwnedByteTransfer.materialize(face.bytes),
                    sha256Hex: face.sha256Hex,
                    genericRole: face.genericRole,
                    language: face.language,
                  ),
              ],
            ),
    );
    liveSessions.add(operation.sessionId);
    return wireBytes;
  } on RitoNativeException catch (error) {
    if (error.status == ritoNativeStatusExactSeekPendingV1) {
      // This typed status proves FFI retained a resumable pending-open actor.
      liveSessions.add(operation.sessionId);
    }
    rethrow;
  }
}

Object? _release(
  RitoNativeWireBindings bindings,
  _ReleaseArtifactOperation operation,
) {
  bindings.releaseArtifact(
    sessionId: operation.sessionId,
    artifactId: operation.artifactId,
  );
  return null;
}

Object? _dispose(
  RitoNativeWireBindings bindings,
  _DisposeOperation operation,
  Set<int> liveSessions,
) {
  bindings.dispose(sessionId: operation.sessionId);
  liveSessions.remove(operation.sessionId);
  return null;
}

Object? _disposeAll(RitoNativeWireBindings bindings, Set<int> liveSessions) {
  Object? firstError;
  StackTrace? firstStackTrace;
  for (final sessionId in liveSessions.toList(growable: false)) {
    try {
      bindings.dispose(sessionId: sessionId);
      liveSessions.remove(sessionId);
    } on Object catch (error, stackTrace) {
      firstError ??= error;
      firstStackTrace ??= stackTrace;
    }
  }
  if (firstError != null) {
    Error.throwWithStackTrace(firstError, firstStackTrace!);
  }
  return null;
}

final class _WorkerBootstrap {
  const _WorkerBootstrap(this.diagnosticLibrary, this.ready);

  final RitoDynamicLibrarySource? diagnosticLibrary;
  final SendPort ready;
}

final class _WorkerEnvelope {
  const _WorkerEnvelope(this.operation, this.reply);

  final _WorkerOperation operation;
  final SendPort reply;
}

final class _WorkerStop {
  const _WorkerStop();
}

final class _WorkerResult {
  const _WorkerResult({this.value, this.error, this.stackTrace});

  final Object? value;
  final Object? error;
  final StackTrace? stackTrace;
}

sealed class _WorkerOperation {
  const _WorkerOperation();
}

final class _OpenOperation extends _WorkerOperation {
  const _OpenOperation({
    required this.sessionId,
    required this.publicationBytes,
    required this.requestBytes,
    this.pinnedFontFaces,
  });

  final int sessionId;
  final TransferableTypedData publicationBytes;
  final Uint8List requestBytes;
  final List<_PinnedFontFaceTransfer>? pinnedFontFaces;
}

/// One pinned face crossing the worker isolate boundary: bytes ride a
/// [TransferableTypedData] so large faces move without copying.
final class _PinnedFontFaceTransfer {
  const _PinnedFontFaceTransfer({
    required this.bytes,
    required this.sha256Hex,
    required this.genericRole,
    required this.language,
  });

  final TransferableTypedData bytes;
  final String sha256Hex;
  final RitoPinnedFontGenericRole genericRole;
  final String? language;
}

final class _RequestArtifactOperation extends _WorkerOperation {
  const _RequestArtifactOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _RequestAdjacentOperation extends _WorkerOperation {
  const _RequestAdjacentOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _PeekAdjacentOperation extends _WorkerOperation {
  const _PeekAdjacentOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _CommitPeekedOperation extends _WorkerOperation {
  const _CommitPeekedOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadPublicationOperation extends _WorkerOperation {
  const _ReadPublicationOperation(this.sessionId);

  final int sessionId;
}

final class _AdoptForegroundOperation extends _WorkerOperation {
  const _AdoptForegroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _AdvanceBackgroundOperation extends _WorkerOperation {
  const _AdvanceBackgroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _AdoptBackgroundOperation extends _WorkerOperation {
  const _AdoptBackgroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadResourceOperation extends _WorkerOperation {
  const _ReadResourceOperation({
    required this.sessionId,
    required this.artifactId,
    required this.kind,
    required this.href,
  });

  final int sessionId;
  final int artifactId;
  final RitoResourceKind kind;
  final String href;
}

final class _SearchOperation extends _WorkerOperation {
  const _SearchOperation({required this.sessionId, required this.requestBytes});

  final int sessionId;
  final Uint8List requestBytes;
}

final class _TextRangeGeometryOperation extends _WorkerOperation {
  const _TextRangeGeometryOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadFootnoteOperation extends _WorkerOperation {
  const _ReadFootnoteOperation({
    required this.sessionId,
    required this.artifactId,
    required this.key,
  });

  final int sessionId;
  final int artifactId;
  final String key;
}

final class _ReleaseArtifactOperation extends _WorkerOperation {
  const _ReleaseArtifactOperation({
    required this.sessionId,
    required this.artifactId,
  });

  final int sessionId;
  final int artifactId;
}

final class _DisposeOperation extends _WorkerOperation {
  const _DisposeOperation(this.sessionId);

  final int sessionId;
}

final class _CloseOperation extends _WorkerOperation {
  const _CloseOperation();
}
