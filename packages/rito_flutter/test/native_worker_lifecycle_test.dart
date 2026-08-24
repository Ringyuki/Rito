import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/native/worker_lifecycle.dart';

void main() {
  test(
    'completed operations are removed from the termination registry',
    () async {
      final latch = RitoWorkerFailureLatch();

      for (var index = 0; index < 1000; index += 1) {
        expect(
          await latch.race<int>(Future<int>.value(index), action: 'request'),
          index,
        );
      }

      expect(latch.pendingOperationCount, 0);
    },
  );

  test('failed operations are removed from the termination registry', () async {
    final latch = RitoWorkerFailureLatch();
    final failure = StateError('operation failed');

    await expectLater(
      latch.race<void>(Future<void>.error(failure), action: 'request'),
      throwsA(same(failure)),
    );

    expect(latch.pendingOperationCount, 0);
  });

  test('unexpected exit rejects every in-flight operation promptly', () async {
    final latch = RitoWorkerFailureLatch();
    final active = Completer<int>();
    final pending = Completer<int>();
    final activeResult = latch.race<int>(
      active.future,
      action: 'active request',
    );
    final pendingResult = latch.race<int>(
      pending.future,
      action: 'pending request',
    );

    latch.reportExit();

    expect(latch.pendingOperationCount, 0);

    await expectLater(
      activeResult.timeout(const Duration(seconds: 1)),
      throwsA(isA<RitoNativeWorkerTerminatedException>()),
    );
    await expectLater(
      pendingResult.timeout(const Duration(seconds: 1)),
      throwsA(isA<RitoNativeWorkerTerminatedException>()),
    );
  });

  test(
    'fatal error wins when it follows an exit signal in the same turn',
    () async {
      final latch = RitoWorkerFailureLatch()..beginClose();
      var settledCount = 0;
      final signals = RitoWorkerSignalArbiter(
        latch: latch,
        onSettled: () {
          settledCount += 1;
        },
      );
      final closeWait = latch.waitForExit();

      signals.reportExit();
      signals.reportError(<Object?>['late dispose panic', 'bindings.dart:21']);

      await expectLater(
        closeWait,
        throwsA(
          isA<RitoNativeWorkerTerminatedException>().having(
            (error) => error.remoteError,
            'remoteError',
            'late dispose panic',
          ),
        ),
      );
      expect(settledCount, 1);
      signals.dispose();
    },
  );

  test('exit signal settles after the fatal-error arbitration turn', () async {
    final latch = RitoWorkerFailureLatch()..beginClose();
    var settledCount = 0;
    final signals = RitoWorkerSignalArbiter(
      latch: latch,
      onSettled: () {
        settledCount += 1;
      },
    );

    signals.reportExit();

    await latch.waitForExit().timeout(const Duration(seconds: 1));
    expect(settledCount, 1);
    signals.dispose();
  });

  test('failed close stays closed to work but permits one retry', () async {
    final gate = RitoWorkerCloseGate();
    var attempts = 0;

    final first = gate.run(() async {
      attempts += 1;
      throw StateError('native dispose failed');
    });
    expect(gate.operationsClosed, isTrue);
    await expectLater(first, throwsStateError);

    final second = gate.run(() async {
      attempts += 1;
    });
    await second;
    expect(attempts, 2);
    expect(
      identical(
        gate.run(() async {
          attempts += 1;
        }),
        second,
      ),
      isTrue,
    );
    expect(attempts, 2);
  });

  test('concurrent close callers share one active attempt', () async {
    final gate = RitoWorkerCloseGate();
    final release = Completer<void>();
    var attempts = 0;

    final first = gate.run(() async {
      attempts += 1;
      await release.future;
    });
    final second = gate.run(() async {
      attempts += 1;
    });

    expect(identical(first, second), isTrue);
    expect(attempts, 1);
    release.complete();
    await first;
  });

  test('unexpected isolate error rejects work with its diagnostic', () async {
    final latch = RitoWorkerFailureLatch();
    final operation = latch.race<void>(
      Completer<void>().future,
      action: 'resource read',
    );

    latch.reportError(<Object?>['native worker panic', 'worker.dart:42']);

    await expectLater(
      operation.timeout(const Duration(seconds: 1)),
      throwsA(
        isA<RitoNativeWorkerTerminatedException>()
            .having(
              (error) => error.remoteError,
              'remoteError',
              'native worker panic',
            )
            .having(
              (error) => error.toString(),
              'message',
              contains('failed unexpectedly'),
            ),
      ),
    );
  });

  test('exit during close settles acknowledgement and exit waits', () async {
    final latch = RitoWorkerFailureLatch()..beginClose();
    final acknowledgement = latch.race<void>(
      Completer<void>().future,
      action: 'close acknowledgement',
    );

    latch.reportExit();

    await expectLater(
      acknowledgement.timeout(const Duration(seconds: 1)),
      throwsA(
        isA<RitoNativeWorkerTerminatedException>().having(
          (error) => error.message,
          'message',
          contains('before close acknowledgement completed'),
        ),
      ),
    );
    await latch.waitForExit().timeout(const Duration(seconds: 1));
    latch.reportExit();
  });

  test(
    'fatal error during close is never treated as an expected exit',
    () async {
      final latch = RitoWorkerFailureLatch()..beginClose();
      final closeWait = latch.waitForExit();

      latch.reportError(<Object?>['dispose panic', 'bindings.dart:17']);

      await expectLater(
        closeWait.timeout(const Duration(seconds: 1)),
        throwsA(
          isA<RitoNativeWorkerTerminatedException>().having(
            (error) => error.remoteError,
            'remoteError',
            'dispose panic',
          ),
        ),
      );
    },
  );
}
