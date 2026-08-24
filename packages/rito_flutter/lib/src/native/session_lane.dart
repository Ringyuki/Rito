import 'dart:async';

/// A navigation request that was replaced by newer intent.
///
/// An active native call is allowed to finish, but its successful result is
/// cleaned up instead of being exposed to the caller.
final class RitoNavigationSupersededException implements Exception {
  const RitoNavigationSupersededException({
    required this.sessionId,
    required this.requestId,
    this.replacementRequestId,
  });

  final int sessionId;
  final int requestId;
  final int? replacementRequestId;

  @override
  String toString() {
    final replacement = replacementRequestId;
    if (replacement == null) {
      return 'Rito navigation request $requestId for session $sessionId was '
          'superseded because the session is closing.';
    }
    return 'Rito navigation request $requestId for session $sessionId was '
        'superseded by request $replacement.';
  }
}

/// The native session was invalidated because ownership cleanup failed.
///
/// Continuing after this error could expose an artifact whose native owner is
/// unknown. The lane therefore rejects all queued and future work after making
/// one best-effort attempt to dispose the session.
final class RitoNativeSessionInvalidatedException implements Exception {
  const RitoNativeSessionInvalidatedException({
    required this.sessionId,
    required this.requestId,
    required this.cleanupError,
  });

  final int sessionId;
  final int requestId;
  final Object cleanupError;

  @override
  String toString() {
    return 'Rito native session $sessionId was invalidated while reclaiming '
        'ownership after request $requestId: $cleanupError';
  }
}

/// Serializes native ownership operations while retaining at most one waiting
/// navigation request.
///
/// This class is internal to the adapter. It is public only so deterministic
/// tests can exercise the scheduler without loading a native library.
final class RitoNativeSessionLane {
  RitoNativeSessionLane(this.sessionId);

  final int sessionId;

  _LaneEntry? _head;
  _LaneEntry? _tail;
  _LaneEntry? _active;
  _NavigationEntryBase? _queuedNavigation;
  Future<void>? _disposeFuture;
  RitoNativeSessionInvalidatedException? _invalidation;
  StackTrace? _invalidationStackTrace;
  bool _closing = false;

  Future<T> scheduleNavigation<T>({
    required int requestId,
    required Future<T> Function() operation,
    Future<void> Function(T result)? onSupersededResult,
    Future<void> Function(Object error, StackTrace stackTrace)?
    onSupersededCleanupFailure,
  }) {
    if (_closing) {
      return _closedFuture<T>();
    }
    final entry = _NavigationEntry<T>(
      sessionId: sessionId,
      requestId: requestId,
      operation: operation,
      onSupersededResult: onSupersededResult,
      onSupersededCleanupFailure: onSupersededCleanupFailure,
      invalidate: _invalidate,
    );
    final active = _active;
    if (active is _NavigationEntryBase) {
      active.markSuperseded(replacementRequestId: requestId);
    }
    final previous = _queuedNavigation;
    if (previous != null) {
      _unlink(previous);
      previous.completeSuperseded(
        sessionId: sessionId,
        replacementRequestId: requestId,
      );
    }
    _append(entry);
    _queuedNavigation = entry;
    _pump();
    return entry.future;
  }

  Future<T> scheduleOrdered<T>(Future<T> Function() operation) {
    if (_closing) {
      return _closedFuture<T>();
    }
    return _appendOrdered(operation);
  }

  Future<void> dispose(Future<void> Function() operation) {
    final existing = _disposeFuture;
    if (existing != null) {
      return existing;
    }
    _closing = true;
    final active = _active;
    if (active is _NavigationEntryBase) {
      active.markSuperseded();
    }
    final queued = _queuedNavigation;
    if (queued != null) {
      _unlink(queued);
      queued.completeSuperseded(sessionId: sessionId);
      _queuedNavigation = null;
    }
    final future = _appendOrdered<void>(operation);
    _disposeFuture = future;
    return future;
  }

  Future<RitoNativeSessionInvalidatedException> invalidate({
    required int requestId,
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
    required Future<void> Function(Object error, StackTrace stackTrace)?
    disposeAfterCleanupFailure,
  }) async {
    await _invalidate(
      requestId: requestId,
      cleanupError: cleanupError,
      cleanupStackTrace: cleanupStackTrace,
      disposeAfterCleanupFailure: disposeAfterCleanupFailure,
    );
    return _invalidation!;
  }

  Future<T> _appendOrdered<T>(Future<T> Function() operation) {
    final entry = _OrderedEntry<T>(operation);
    _append(entry);
    _pump();
    return entry.future;
  }

  Future<T> _closedFuture<T>() {
    final invalidation = _invalidation;
    if (invalidation != null) {
      return Future<T>.error(invalidation, _invalidationStackTrace);
    }
    return Future<T>.error(
      StateError('Rito native session $sessionId is closing.'),
      StackTrace.current,
    );
  }

  void _append(_LaneEntry entry) {
    final tail = _tail;
    if (tail == null) {
      _head = entry;
    } else {
      tail.next = entry;
      entry.previous = tail;
    }
    _tail = entry;
  }

  void _unlink(_LaneEntry entry) {
    final previous = entry.previous;
    final next = entry.next;
    if (previous == null) {
      _head = next;
    } else {
      previous.next = next;
    }
    if (next == null) {
      _tail = previous;
    } else {
      next.previous = previous;
    }
    entry
      ..previous = null
      ..next = null;
  }

  _LaneEntry? _takeHead() {
    final entry = _head;
    if (entry == null) {
      return null;
    }
    _unlink(entry);
    if (identical(entry, _queuedNavigation)) {
      _queuedNavigation = null;
    }
    return entry;
  }

  void _pump() {
    if (_active != null) {
      return;
    }
    final entry = _takeHead();
    if (entry == null) {
      return;
    }
    _active = entry;
    unawaited(
      entry.run().whenComplete(() {
        _active = null;
        _pump();
      }),
    );
  }

  Future<void> _invalidate({
    required int requestId,
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
    required Future<void> Function(Object error, StackTrace stackTrace)?
    disposeAfterCleanupFailure,
  }) async {
    if (_invalidation != null) {
      return;
    }
    final invalidation = RitoNativeSessionInvalidatedException(
      sessionId: sessionId,
      requestId: requestId,
      cleanupError: cleanupError,
    );
    _invalidation = invalidation;
    _invalidationStackTrace = cleanupStackTrace;
    _closing = true;
    _failPending(invalidation, cleanupStackTrace);
    final disposal = _disposeAfterCleanupFailure(
      cleanupError: cleanupError,
      cleanupStackTrace: cleanupStackTrace,
      operation: disposeAfterCleanupFailure,
    );
    _disposeFuture = disposal;
    try {
      await disposal;
    } on Object {
      // The stale request still completes as superseded. The retained dispose
      // future reports a failed fail-closed attempt to an explicit disposer or
      // gateway close without allowing any more session work to run.
    }
  }

  void _failPending(Object error, StackTrace stackTrace) {
    var entry = _head;
    _head = null;
    _tail = null;
    _queuedNavigation = null;
    while (entry != null) {
      final next = entry.next;
      entry
        ..previous = null
        ..next = null
        ..fail(error, stackTrace);
      entry = next;
    }
  }

  Future<void> _disposeAfterCleanupFailure({
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
    required Future<void> Function(Object error, StackTrace stackTrace)?
    operation,
  }) async {
    if (operation != null) {
      await operation(cleanupError, cleanupStackTrace);
    }
  }
}

abstract base class _LaneEntry {
  _LaneEntry? previous;
  _LaneEntry? next;

  Future<void> run();

  void fail(Object error, StackTrace stackTrace);
}

final class _OrderedEntry<T> extends _LaneEntry {
  _OrderedEntry(this.operation);

  final Future<T> Function() operation;
  final Completer<T> _completer = Completer<T>();

  Future<T> get future => _completer.future;

  @override
  Future<void> run() async {
    try {
      _completer.complete(await operation());
    } on Object catch (error, stackTrace) {
      _completer.completeError(error, stackTrace);
    }
  }

  @override
  void fail(Object error, StackTrace stackTrace) {
    _completer.completeError(error, stackTrace);
  }
}

abstract base class _NavigationEntryBase extends _LaneEntry {
  int get requestId;

  void markSuperseded({int? replacementRequestId});

  void completeSuperseded({required int sessionId, int? replacementRequestId});
}

final class _NavigationEntry<T> extends _NavigationEntryBase {
  _NavigationEntry({
    required this.sessionId,
    required this.requestId,
    required this.operation,
    required this.onSupersededResult,
    required this.onSupersededCleanupFailure,
    required this.invalidate,
  });

  final int sessionId;
  @override
  final int requestId;
  final Future<T> Function() operation;
  final Future<void> Function(T result)? onSupersededResult;
  final Future<void> Function(Object error, StackTrace stackTrace)?
  onSupersededCleanupFailure;
  final Future<void> Function({
    required int requestId,
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
    required Future<void> Function(Object error, StackTrace stackTrace)?
    disposeAfterCleanupFailure,
  })
  invalidate;
  final Completer<T> _completer = Completer<T>();
  bool _superseded = false;
  int? _replacementRequestId;

  Future<T> get future => _completer.future;

  @override
  void markSuperseded({int? replacementRequestId}) {
    _superseded = true;
    _replacementRequestId = replacementRequestId;
  }

  @override
  void completeSuperseded({required int sessionId, int? replacementRequestId}) {
    _completer.completeError(
      RitoNavigationSupersededException(
        sessionId: sessionId,
        requestId: requestId,
        replacementRequestId: replacementRequestId,
      ),
      StackTrace.current,
    );
  }

  @override
  Future<void> run() async {
    late final T result;
    try {
      result = await operation();
    } on Object catch (error, stackTrace) {
      _completer.completeError(error, stackTrace);
      return;
    }
    if (!_superseded) {
      _completer.complete(result);
      return;
    }
    final cleanup = onSupersededResult;
    if (cleanup != null) {
      try {
        await cleanup(result);
      } on Object catch (error, stackTrace) {
        await invalidate(
          requestId: requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
          disposeAfterCleanupFailure: onSupersededCleanupFailure,
        );
      }
    }
    completeSuperseded(
      sessionId: sessionId,
      replacementRequestId: _replacementRequestId,
    );
  }

  @override
  void fail(Object error, StackTrace stackTrace) {
    _completer.completeError(error, stackTrace);
  }
}
