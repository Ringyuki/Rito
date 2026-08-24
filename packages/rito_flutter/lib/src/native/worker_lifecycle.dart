import 'dart:async';

/// Raised when the native worker terminates before acknowledging an operation.
final class RitoNativeWorkerTerminatedException implements Exception {
  const RitoNativeWorkerTerminatedException({
    required this.message,
    this.remoteError,
  });

  final String message;
  final String? remoteError;

  @override
  String toString() {
    final detail = remoteError;
    return detail == null
        ? 'RitoNativeWorkerTerminatedException: $message'
        : 'RitoNativeWorkerTerminatedException: $message ($detail)';
  }
}

/// Shared failure latch for every request sent to one native worker.
///
/// The transport feeds isolate error and exit events into this object. Every
/// in-flight request registers one removable completion entry, so a dead
/// worker cannot leave request, disposal, or close futures unresolved and
/// completed requests do not accumulate listeners on one shared future.
final class RitoWorkerFailureLatch {
  final Completer<_RitoWorkerTermination> _termination =
      Completer<_RitoWorkerTermination>();
  final Map<int, _RitoPendingWorkerOperationEntry> _pending =
      <int, _RitoPendingWorkerOperationEntry>{};
  _RitoWorkerTermination? _terminationValue;
  int _nextPendingId = 0;
  bool _closing = false;

  bool get isTerminated => _terminationValue != null;

  /// Number of operations which still need either a reply or termination.
  ///
  /// Exposed from this internal lifecycle type so bounded-retention tests can
  /// distinguish live requests from stale listeners.
  int get pendingOperationCount => _pending.length;

  void beginClose() {
    _closing = true;
  }

  void reportExit() {
    if (isTerminated) {
      return;
    }
    if (_closing) {
      _terminate(const _RitoWorkerTermination.expectedExit());
      return;
    }
    _terminate(
      _RitoWorkerTermination.failure(
        const RitoNativeWorkerTerminatedException(
          message: 'Rito native worker exited unexpectedly.',
        ),
        StackTrace.current,
      ),
    );
  }

  void reportError(Object? message) {
    if (isTerminated) {
      return;
    }
    final diagnostic = _remoteDiagnostic(message);
    _terminate(
      _RitoWorkerTermination.failure(
        RitoNativeWorkerTerminatedException(
          message: 'Rito native worker failed unexpectedly.',
          remoteError: diagnostic.error,
        ),
        diagnostic.stackTrace,
      ),
    );
  }

  Future<T> race<T>(Future<T> operation, {required String action}) {
    final termination = _terminationValue;
    if (termination != null) {
      return _terminatedFuture<T>(termination, action: action);
    }

    final pendingId = _nextPendingId++;
    final pending = _RitoPendingWorkerOperation<T>(action);
    _pending[pendingId] = pending;
    operation.then<void>(
      (value) {
        if (identical(_pending.remove(pendingId), pending)) {
          pending.complete(value);
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        if (identical(_pending.remove(pendingId), pending)) {
          pending.completeError(error, stackTrace);
        }
      },
    );
    return pending.future;
  }

  Future<void> waitForExit() async {
    final termination = _terminationValue ?? await _termination.future;
    final error = termination.error;
    if (error != null) {
      Error.throwWithStackTrace(error, termination.stackTrace!);
    }
  }

  void _terminate(_RitoWorkerTermination termination) {
    _terminationValue = termination;
    _termination.complete(termination);
    final pending = _pending.values.toList(growable: false);
    _pending.clear();
    for (final operation in pending) {
      operation.terminate(termination);
    }
  }
}

/// Resolves exit/error signals without letting an exit on one isolate port
/// mask a fatal diagnostic already queued on the other port.
final class RitoWorkerSignalArbiter {
  RitoWorkerSignalArbiter({required this.latch, required this.onSettled});

  final RitoWorkerFailureLatch latch;
  final void Function() onSettled;
  Timer? _pendingExit;
  bool _settled = false;

  void reportExit() {
    if (_settled || _pendingExit != null) {
      return;
    }
    _pendingExit = Timer(Duration.zero, () {
      _pendingExit = null;
      if (_settled) {
        return;
      }
      _settled = true;
      latch.reportExit();
      onSettled();
    });
  }

  void reportError(Object? message) {
    if (_settled) {
      return;
    }
    _pendingExit?.cancel();
    _pendingExit = null;
    _settled = true;
    latch.reportError(message);
    onSettled();
  }

  void dispose() {
    _pendingExit?.cancel();
    _pendingExit = null;
  }
}

/// Serializes close attempts, caches success, and permits retry after failure.
/// Once close starts, ordinary worker operations remain permanently rejected.
final class RitoWorkerCloseGate {
  Future<void>? _attempt;
  bool _operationsClosed = false;

  bool get operationsClosed => _operationsClosed;

  Future<void> run(Future<void> Function() closeAttempt) {
    _operationsClosed = true;
    final existing = _attempt;
    if (existing != null) {
      return existing;
    }

    final completer = Completer<void>();
    final attempt = completer.future;
    _attempt = attempt;
    Future<void>.sync(closeAttempt).then<void>(
      (_) {
        completer.complete();
      },
      onError: (Object error, StackTrace stackTrace) {
        if (identical(_attempt, attempt)) {
          _attempt = null;
        }
        completer.completeError(error, stackTrace);
      },
    );
    return attempt;
  }
}

abstract interface class _RitoPendingWorkerOperationEntry {
  void terminate(_RitoWorkerTermination termination);
}

final class _RitoPendingWorkerOperation<T>
    implements _RitoPendingWorkerOperationEntry {
  _RitoPendingWorkerOperation(this.action);

  final String action;
  final Completer<T> _completer = Completer<T>();

  Future<T> get future => _completer.future;

  void complete(T value) {
    _completer.complete(value);
  }

  void completeError(Object error, StackTrace stackTrace) {
    _completer.completeError(error, stackTrace);
  }

  @override
  void terminate(_RitoWorkerTermination termination) {
    final error = termination.error;
    if (error != null) {
      _completer.completeError(error, termination.stackTrace!);
      return;
    }
    _completer.completeError(
      RitoNativeWorkerTerminatedException(
        message: 'Rito native worker exited before $action completed.',
      ),
      StackTrace.current,
    );
  }
}

Future<T> _terminatedFuture<T>(
  _RitoWorkerTermination termination, {
  required String action,
}) {
  final error = termination.error;
  if (error != null) {
    return Future<T>.error(error, termination.stackTrace!);
  }
  return Future<T>.error(
    RitoNativeWorkerTerminatedException(
      message: 'Rito native worker exited before $action completed.',
    ),
    StackTrace.current,
  );
}

({String? error, StackTrace stackTrace}) _remoteDiagnostic(Object? message) {
  if (message case [final Object? error, final Object? stack, ...]) {
    return (
      error: error?.toString(),
      stackTrace: StackTrace.fromString(stack?.toString() ?? ''),
    );
  }
  return (error: message?.toString(), stackTrace: StackTrace.current);
}

final class _RitoWorkerTermination {
  const _RitoWorkerTermination.expectedExit() : error = null, stackTrace = null;

  const _RitoWorkerTermination.failure(this.error, this.stackTrace);

  final RitoNativeWorkerTerminatedException? error;
  final StackTrace? stackTrace;
}
