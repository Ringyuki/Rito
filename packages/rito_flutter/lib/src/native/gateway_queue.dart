import 'dart:async';

import 'session_lane.dart';

/// Coordinates session lanes and native ownership for the isolate gateway.
///
/// It accepts closures so tests can use a deterministic fake transport.
final class RitoNativeGatewayQueue {
  final Map<int, RitoNativeSessionLane> _sessions =
      <int, RitoNativeSessionLane>{};
  final Set<int> _nativeSessions = <int>{};
  bool _closing = false;
  Future<void>? _closeFuture;

  Future<T> open<T>({
    required int sessionId,
    required int requestId,
    required Future<T> Function() operation,
    required bool Function(Object error) nativeSessionMayExistOnError,
    Future<void> Function(T result)? onSupersededResult,
    Future<void> Function(Object error, StackTrace stackTrace)?
    disposeAfterCleanupFailure,
  }) {
    _requireAccepting();
    final lane = _sessions.putIfAbsent(
      sessionId,
      () => RitoNativeSessionLane(sessionId),
    );
    return lane.scheduleNavigation<T>(
      requestId: requestId,
      operation: () async {
        try {
          final result = await operation();
          _nativeSessions.add(sessionId);
          return result;
        } on Object catch (error) {
          if (nativeSessionMayExistOnError(error)) {
            _nativeSessions.add(sessionId);
          }
          rethrow;
        }
      },
      onSupersededResult: onSupersededResult,
      onSupersededCleanupFailure: disposeAfterCleanupFailure == null
          ? null
          : (error, stackTrace) async {
              await disposeAfterCleanupFailure(error, stackTrace);
              _nativeSessions.remove(sessionId);
            },
    );
  }

  Future<T> navigate<T>({
    required int sessionId,
    required int requestId,
    required Future<T> Function() operation,
    Future<void> Function(T result)? onSupersededResult,
    Future<void> Function(Object error, StackTrace stackTrace)?
    disposeAfterCleanupFailure,
  }) {
    _requireAccepting();
    return _requireSession(sessionId).scheduleNavigation<T>(
      requestId: requestId,
      operation: operation,
      onSupersededResult: onSupersededResult,
      onSupersededCleanupFailure: disposeAfterCleanupFailure == null
          ? null
          : (error, stackTrace) async {
              await disposeAfterCleanupFailure(error, stackTrace);
              _nativeSessions.remove(sessionId);
            },
    );
  }

  Future<RitoNativeSessionInvalidatedException> failClosed({
    required int sessionId,
    required int requestId,
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
    required bool nativeSessionMayExist,
    required Future<void> Function() disposeSession,
  }) {
    final lane = _sessions.putIfAbsent(
      sessionId,
      () => RitoNativeSessionLane(sessionId),
    );
    if (nativeSessionMayExist) {
      _nativeSessions.add(sessionId);
    }
    return lane.invalidate(
      requestId: requestId,
      cleanupError: cleanupError,
      cleanupStackTrace: cleanupStackTrace,
      disposeAfterCleanupFailure: (_, _) async {
        await disposeSession();
        _nativeSessions.remove(sessionId);
      },
    );
  }

  /// Runs one native session operation whose result may become unreadable.
  /// Only failures classified by the caller as terminal invalidate the lane;
  /// typed rejections proven not to mutate are returned unchanged.
  Future<T> guardSessionOperation<T>({
    required int sessionId,
    required int requestId,
    required Future<T> Function() operation,
    required bool Function(Object error) requiresFailClose,
    required Future<void> Function() disposeSession,
  }) async {
    try {
      return await operation();
    } on Object catch (error, stackTrace) {
      if (!requiresFailClose(error)) {
        rethrow;
      }
      final invalidation = await failClosed(
        sessionId: sessionId,
        requestId: requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
        nativeSessionMayExist: true,
        disposeSession: disposeSession,
      );
      Error.throwWithStackTrace(invalidation, stackTrace);
    }
  }

  Future<T> ordered<T>({
    required int sessionId,
    required Future<T> Function() operation,
  }) {
    _requireAccepting();
    return _requireSession(sessionId).scheduleOrdered<T>(operation);
  }

  Future<void> dispose({
    required int sessionId,
    required Future<void> Function() operation,
  }) {
    if (_closing && !_sessions.containsKey(sessionId)) {
      return Future<void>.error(
        StateError('Rito native gateway is closing.'),
        StackTrace.current,
      );
    }
    final lane = _sessions.putIfAbsent(
      sessionId,
      () => RitoNativeSessionLane(sessionId),
    );
    return _disposeLane(lane, operation);
  }

  Future<void> close({
    required Future<void> Function(int sessionId) disposeSession,
    required Future<void> Function() closeTransport,
  }) {
    final existing = _closeFuture;
    if (existing != null) {
      return existing;
    }
    _closing = true;
    final disposals = _sessions.values
        .map((lane) => _disposeLane(lane, () => disposeSession(lane.sessionId)))
        .toList(growable: false);
    final completer = Completer<void>();
    final attempt = completer.future;
    _closeFuture = attempt;
    Future<void>.sync(() => _finishClose(disposals, closeTransport)).then<void>(
      (_) {
        completer.complete();
      },
      onError: (Object error, StackTrace stackTrace) {
        if (identical(_closeFuture, attempt)) {
          _closeFuture = null;
        }
        completer.completeError(error, stackTrace);
      },
    );
    return attempt;
  }

  Future<void> _disposeLane(
    RitoNativeSessionLane lane,
    Future<void> Function() operation,
  ) {
    return lane.dispose(() async {
      if (!_nativeSessions.contains(lane.sessionId)) {
        return;
      }
      await operation();
      _nativeSessions.remove(lane.sessionId);
    });
  }

  Future<void> _finishClose(
    List<Future<void>> disposals,
    Future<void> Function() closeTransport,
  ) async {
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final disposal in disposals) {
      try {
        await disposal;
      } on Object catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    try {
      await closeTransport();
    } on Object catch (error, stackTrace) {
      firstError ??= error;
      firstStackTrace ??= stackTrace;
      Error.throwWithStackTrace(firstError, firstStackTrace);
    }
    // A successful transport close runs the worker's global dispose-all path,
    // which is the final ownership proof even if an earlier per-session retry
    // remained represented by a retained failed Future.
  }

  RitoNativeSessionLane _requireSession(int sessionId) {
    final lane = _sessions[sessionId];
    if (lane == null) {
      throw StateError('Rito native session $sessionId is not open.');
    }
    return lane;
  }

  void _requireAccepting() {
    if (_closing) {
      throw StateError('Rito native gateway is closing.');
    }
  }
}
