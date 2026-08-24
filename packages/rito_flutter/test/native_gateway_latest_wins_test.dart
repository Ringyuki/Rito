import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/native/bindings.dart';
import 'package:rito_flutter/src/native/gateway_queue.dart';
import 'package:rito_flutter/src/native/session_lane.dart';

void main() {
  test(
    '32 mixed requests discard the active result and execute only the latest',
    () async {
      final transport = _FakeTransport();
      final lane = RitoNativeSessionLane(7);
      final activeGate = Completer<void>();
      final first = lane.scheduleNavigation<int>(
        requestId: 1,
        operation: () =>
            transport.navigation(1, kind: 'seek', gate: activeGate),
        onSupersededResult: (result) => transport.ownership('discard:$result'),
      );
      final firstFailure = expectLater(
        first,
        throwsA(
          _superseded(sessionId: 7, requestId: 1, replacementRequestId: 32),
        ),
      );
      final staleChecks = <Future<void>>[];
      late Future<int> latest;
      for (var requestId = 2; requestId <= 32; requestId += 1) {
        final kind = requestId.isEven ? 'adjacent' : 'seek';
        final candidate = lane.scheduleNavigation<int>(
          requestId: requestId,
          operation: () => transport.navigation(requestId, kind: kind),
        );
        if (requestId == 32) {
          latest = candidate;
        } else {
          staleChecks.add(
            expectLater(
              candidate,
              throwsA(
                _superseded(
                  sessionId: 7,
                  requestId: requestId,
                  replacementRequestId: requestId + 1,
                ),
              ),
            ),
          );
        }
      }

      await Future.wait(staleChecks);
      expect(transport.calls, <String>['seek:1']);
      activeGate.complete();

      await firstFailure;
      expect(await latest, 32);
      expect(transport.calls, <String>['seek:1', 'discard:1', 'adjacent:32']);
    },
  );

  test(
    'active failure does not prevent the latest request from running',
    () async {
      final transport = _FakeTransport();
      final lane = RitoNativeSessionLane(11);
      final activeGate = Completer<void>();
      final active = lane.scheduleNavigation<int>(
        requestId: 1,
        operation: () =>
            transport.navigation(1, kind: 'seek', gate: activeGate, fail: true),
        onSupersededResult: (result) => transport.ownership('discard:$result'),
      );
      final activeFailure = expectLater(active, throwsStateError);
      final stale = lane.scheduleNavigation<int>(
        requestId: 2,
        operation: () => transport.navigation(2, kind: 'adjacent'),
      );
      final staleFailure = expectLater(
        stale,
        throwsA(
          _superseded(sessionId: 11, requestId: 2, replacementRequestId: 3),
        ),
      );
      final latest = lane.scheduleNavigation<int>(
        requestId: 3,
        operation: () => transport.navigation(3, kind: 'seek'),
      );

      activeGate.complete();
      await activeFailure;
      await staleFailure;
      expect(await latest, 3);
      expect(transport.calls, <String>['seek:1', 'seek:3']);
    },
  );

  test('dispose stales queued navigation and waits for ordered work', () async {
    final transport = _FakeTransport();
    final lane = RitoNativeSessionLane(13);
    final activeGate = Completer<void>();
    final active = lane.scheduleNavigation<int>(
      requestId: 1,
      operation: () => transport.navigation(1, kind: 'seek', gate: activeGate),
    );
    final activeFailure = expectLater(
      active,
      throwsA(_superseded(sessionId: 13, requestId: 1)),
    );
    final stale = lane.scheduleNavigation<int>(
      requestId: 2,
      operation: () => transport.navigation(2, kind: 'adjacent'),
    );
    final staleFailure = expectLater(
      stale,
      throwsA(_superseded(sessionId: 13, requestId: 2)),
    );
    final resource = lane.scheduleOrdered<void>(
      () => transport.ownership('resource'),
    );
    final dispose = lane.dispose(() => transport.ownership('dispose'));

    await staleFailure;
    expect(transport.calls, <String>['seek:1']);
    activeGate.complete();
    await activeFailure;
    await resource;
    await dispose;
    expect(transport.calls, <String>['seek:1', 'resource', 'dispose']);
    await expectLater(
      lane.scheduleNavigation<int>(
        requestId: 3,
        operation: () => transport.navigation(3, kind: 'seek'),
      ),
      throwsStateError,
    );
  });

  test('different sessions maintain independent active navigation', () async {
    final transport = _FakeTransport();
    final firstGate = Completer<void>();
    final secondGate = Completer<void>();
    final first = RitoNativeSessionLane(17).scheduleNavigation<int>(
      requestId: 1,
      operation: () =>
          transport.navigation(17, kind: 'session', gate: firstGate),
    );
    final second = RitoNativeSessionLane(19).scheduleNavigation<int>(
      requestId: 1,
      operation: () =>
          transport.navigation(19, kind: 'session', gate: secondGate),
    );

    expect(transport.calls, <String>['session:17', 'session:19']);
    secondGate.complete();
    expect(await second, 19);
    firstGate.complete();
    expect(await first, 17);
  });

  test(
    'resource and release remain FIFO barriers around replacement',
    () async {
      final transport = _FakeTransport();
      final lane = RitoNativeSessionLane(23);
      final activeGate = Completer<void>();
      final active = lane.scheduleNavigation<int>(
        requestId: 1,
        operation: () =>
            transport.navigation(1, kind: 'seek', gate: activeGate),
        onSupersededResult: (result) => transport.ownership('discard:$result'),
      );
      final activeFailure = expectLater(
        active,
        throwsA(
          _superseded(sessionId: 23, requestId: 1, replacementRequestId: 3),
        ),
      );
      final resource = lane.scheduleOrdered<void>(
        () => transport.ownership('resource'),
      );
      final stale = lane.scheduleNavigation<int>(
        requestId: 2,
        operation: () => transport.navigation(2, kind: 'adjacent'),
      );
      final staleFailure = expectLater(
        stale,
        throwsA(
          _superseded(sessionId: 23, requestId: 2, replacementRequestId: 3),
        ),
      );
      final release = lane.scheduleOrdered<void>(
        () => transport.ownership('release'),
      );
      final latest = lane.scheduleNavigation<int>(
        requestId: 3,
        operation: () => transport.navigation(3, kind: 'seek'),
      );

      await staleFailure;
      activeGate.complete();
      await activeFailure;
      await resource;
      await release;
      expect(await latest, 3);
      expect(transport.calls, <String>[
        'seek:1',
        'discard:1',
        'resource',
        'release',
        'seek:3',
      ]);
    },
  );

  test(
    'pending open ownership is retained until explicit disposal',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      const pending = RitoNativeException(
        status: ritoNativeStatusExactSeekPendingV1,
        message: 'initial exact target is pending',
      );

      await expectLater(
        queue.open<int>(
          sessionId: 25,
          requestId: 1,
          operation: () async {
            transport.calls.add('open-pending:25');
            throw pending;
          },
          nativeSessionMayExistOnError: (error) => identical(error, pending),
        ),
        throwsA(same(pending)),
      );
      await queue.dispose(
        sessionId: 25,
        operation: () => transport.dispose(25),
      );

      expect(transport.calls, <String>['open-pending:25', 'dispose:25']);
    },
  );

  test(
    'stale cleanup failure disposes once and invalidates queued work',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      await _openQueue(queue, 27, () => transport.open(27));
      final activeGate = Completer<void>();
      final active = queue.navigate<int>(
        sessionId: 27,
        requestId: 1,
        operation: () =>
            transport.navigation(1, kind: 'seek', gate: activeGate),
        onSupersededResult: (result) async {
          await transport.ownership('release:$result');
          throw StateError('release failed');
        },
        disposeAfterCleanupFailure: (_, _) => transport.dispose(27),
      );
      final activeFailure = expectLater(
        active,
        throwsA(
          _superseded(sessionId: 27, requestId: 1, replacementRequestId: 2),
        ),
      );
      final queued = queue.navigate<int>(
        sessionId: 27,
        requestId: 2,
        operation: () => transport.navigation(2, kind: 'seek'),
      );
      final queuedFailure = expectLater(
        queued,
        throwsA(
          isA<RitoNativeSessionInvalidatedException>()
              .having((error) => error.sessionId, 'sessionId', 27)
              .having((error) => error.requestId, 'requestId', 1),
        ),
      );

      activeGate.complete();
      await activeFailure;
      await queuedFailure;
      await queue.dispose(
        sessionId: 27,
        operation: () => transport.dispose(27),
      );
      expect(transport.calls, <String>[
        'open:27',
        'seek:1',
        'release:1',
        'dispose:27',
      ]);
      await expectLater(
        queue.navigate<int>(
          sessionId: 27,
          requestId: 3,
          operation: () => transport.navigation(3, kind: 'seek'),
        ),
        throwsA(isA<RitoNativeSessionInvalidatedException>()),
      );
    },
  );

  test(
    'ambiguous mutation failure disposes once and terminalizes the lane',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      await _openQueue(queue, 28, () => transport.open(28));
      final mutationFailure = StateError(
        'transport ended after native mutation',
      );

      await expectLater(
        queue.ordered<int>(
          sessionId: 28,
          operation: () => queue.guardSessionOperation<int>(
            sessionId: 28,
            requestId: 9,
            operation: () async {
              transport.calls.add('mutation:28');
              throw mutationFailure;
            },
            requiresFailClose: (_) => true,
            disposeSession: () => transport.dispose(28),
          ),
        ),
        throwsA(
          isA<RitoNativeSessionInvalidatedException>()
              .having((error) => error.sessionId, 'sessionId', 28)
              .having((error) => error.requestId, 'requestId', 9)
              .having(
                (error) => error.cleanupError,
                'cleanupError',
                same(mutationFailure),
              ),
        ),
      );
      await expectLater(
        queue.ordered<void>(
          sessionId: 28,
          operation: () => transport.ownership('must-not-run'),
        ),
        throwsA(isA<RitoNativeSessionInvalidatedException>()),
      );
      await queue.dispose(
        sessionId: 28,
        operation: () => transport.dispose(28),
      );

      expect(transport.calls, <String>[
        'open:28',
        'mutation:28',
        'dispose:28',
      ]);
    },
  );

  test(
    'gateway close disposes every open session before transport close',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      expect(
        await _openQueue(queue, 29, () => transport.open(29)),
        29,
      );
      expect(
        await _openQueue(queue, 31, () => transport.open(31)),
        31,
      );

      await queue.close(
        disposeSession: transport.dispose,
        closeTransport: transport.close,
      );
      expect(transport.calls, <String>[
        'open:29',
        'open:31',
        'dispose:29',
        'dispose:31',
        'close',
      ]);
    },
  );

  test(
    'global close reclaims a malformed session after per-session disposal fails',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      await _openQueue(queue, 37, () => transport.open(37));
      final cleanupError = StateError('artifact release failed');

      final invalidation = await queue.failClosed(
        sessionId: 37,
        requestId: 41,
        cleanupError: cleanupError,
        cleanupStackTrace: StackTrace.current,
        nativeSessionMayExist: true,
        disposeSession: () async {
          await transport.dispose(37);
          throw StateError('session dispose failed');
        },
      );

      expect(invalidation.cleanupError, same(cleanupError));
      await expectLater(
        queue.navigate<int>(
          sessionId: 37,
          requestId: 42,
          operation: () => transport.navigation(42, kind: 'seek'),
        ),
        throwsA(isA<RitoNativeSessionInvalidatedException>()),
      );
      await queue.close(
        disposeSession: transport.dispose,
        closeTransport: transport.close,
      );
      expect(transport.calls, <String>['open:37', 'dispose:37', 'close']);
    },
  );

  test(
    'gateway close retries the worker after a failed cleanup attempt',
    () async {
      final transport = _FakeTransport();
      final queue = RitoNativeGatewayQueue();
      await _openQueue(queue, 43, () => transport.open(43));
      var transportCloseAttempts = 0;

      Future<void> failedSessionDispose(int sessionId) async {
        await transport.dispose(sessionId);
        throw StateError('session dispose failed');
      }

      Future<void> retryableTransportClose() async {
        transportCloseAttempts += 1;
        transport.calls.add('close:$transportCloseAttempts');
        if (transportCloseAttempts == 1) {
          throw StateError('worker dispose-all failed');
        }
      }

      final first = queue.close(
        disposeSession: failedSessionDispose,
        closeTransport: retryableTransportClose,
      );
      expect(
        identical(
          first,
          queue.close(
            disposeSession: failedSessionDispose,
            closeTransport: retryableTransportClose,
          ),
        ),
        isTrue,
      );
      await expectLater(first, throwsStateError);

      await queue.close(
        disposeSession: failedSessionDispose,
        closeTransport: retryableTransportClose,
      );

      expect(transport.calls, <String>[
        'open:43',
        'dispose:43',
        'close:1',
        'close:2',
      ]);
    },
  );
}

Future<T> _openQueue<T>(
  RitoNativeGatewayQueue queue,
  int sessionId,
  Future<T> Function() operation,
) {
  return queue.open<T>(
    sessionId: sessionId,
    requestId: 1,
    operation: operation,
    nativeSessionMayExistOnError: (_) => false,
  );
}

Matcher _superseded({
  required int sessionId,
  required int requestId,
  int? replacementRequestId,
}) {
  return isA<RitoNavigationSupersededException>()
      .having((error) => error.sessionId, 'sessionId', sessionId)
      .having((error) => error.requestId, 'requestId', requestId)
      .having(
        (error) => error.replacementRequestId,
        'replacementRequestId',
        replacementRequestId,
      );
}

final class _FakeTransport {
  final List<String> calls = <String>[];

  Future<int> open(int sessionId) async {
    calls.add('open:$sessionId');
    return sessionId;
  }

  Future<int> navigation(
    int requestId, {
    required String kind,
    Completer<void>? gate,
    bool fail = false,
  }) async {
    calls.add('$kind:$requestId');
    if (gate != null) {
      await gate.future;
    }
    if (fail) {
      throw StateError('active navigation failed');
    }
    return requestId;
  }

  Future<void> ownership(String operation) async {
    calls.add(operation);
  }

  Future<void> dispose(int sessionId) async {
    calls.add('dispose:$sessionId');
  }

  Future<void> close() async {
    calls.add('close');
  }
}
