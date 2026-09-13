import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_native.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'retained adjacent yields and advances one quantum across chapters',
    () async {
      const driver = RitoPendingAdjacentDriver(maxContinuationQuanta: 8);
      final requests = <RitoAdjacentRequest>[];
      var hostYields = 0;
      var terminalCalls = 0;
      const pending = RitoNativeException(
        status: ritoNativeStatusAdjacentPending,
        message: 'retained adjacent work remains',
      );

      final artifact = await driver.resume(
        initialRequest: _request(12),
        requestOneQuantum: (request) async {
          requests.add(request);
          if (requests.length < 3) {
            throw pending;
          }
          return _artifact(requestId: request.requestId);
        },
        yieldHostTurn: () async {
          hostYields += 1;
        },
        isCurrent: () => true,
        replacementRequestId: () => null,
        onTerminal: (_, _) async {
          terminalCalls += 1;
        },
      );

      expect(requests.map((request) => request.requestId), <int>[13, 14, 15]);
      expect(
        requests.map((request) => request.fromArtifactId),
        everyElement(7001),
      );
      expect(
        requests.map((request) => request.direction),
        everyElement(RitoAdjacentDirection.next),
      );
      expect(hostYields, 3);
      expect(terminalCalls, 0);
      expect(artifact.requestId, 15);
      expect(artifact.locator.href, 'chapter-5.xhtml');
      expect(artifact.localPageIndex, 0);
    },
  );

  test('plain target-not-published is terminal and is not retried', () async {
    const driver = RitoPendingAdjacentDriver(maxContinuationQuanta: 8);
    const terminal = RitoNativeException(
      status: ritoNativeStatusTargetNotPublished,
      message: 'wording must not control retry',
    );
    var attempts = 0;
    var terminalCalls = 0;

    final resumed = driver.resume(
      initialRequest: _request(20),
      requestOneQuantum: (_) async {
        attempts += 1;
        throw terminal;
      },
      yieldHostTurn: () async {},
      isCurrent: () => true,
      replacementRequestId: () => null,
      onTerminal: (error, _) async {
        expect(error, same(terminal));
        terminalCalls += 1;
      },
    );

    await expectLater(resumed, throwsA(same(terminal)));
    expect(attempts, 1);
    expect(terminalCalls, 1);
  });

  test('retained adjacent continuation has a finite fail-closed cap', () async {
    const driver = RitoPendingAdjacentDriver(maxContinuationQuanta: 3);
    final requestIds = <int>[];
    Object? terminalError;

    final resumed = driver.resume(
      initialRequest: _request(30),
      requestOneQuantum: (request) async {
        requestIds.add(request.requestId);
        throw const RitoNativeException(
          status: ritoNativeStatusAdjacentPending,
          message: 'still retained',
        );
      },
      yieldHostTurn: () async {},
      isCurrent: () => true,
      replacementRequestId: () => null,
      onTerminal: (error, _) async {
        terminalError = error;
      },
    );

    await expectLater(
      resumed,
      throwsA(
        isA<RitoPendingAdjacentLimitException>()
            .having((error) => error.initialRequestId, 'initialRequestId', 30)
            .having((error) => error.lastRequestId, 'lastRequestId', 33)
            .having(
              (error) => error.maxContinuationQuanta,
              'maxContinuationQuanta',
              3,
            ),
      ),
    );
    expect(requestIds, <int>[31, 32, 33]);
    expect(terminalError, isA<RitoPendingAdjacentLimitException>());
  });

  test('cancel during host yield performs no native continuation', () async {
    const driver = RitoPendingAdjacentDriver(maxContinuationQuanta: 8);
    var current = true;
    var attempts = 0;

    final resumed = driver.resume(
      initialRequest: _request(40),
      requestOneQuantum: (_) async {
        attempts += 1;
        return _artifact(requestId: 41);
      },
      yieldHostTurn: () async {
        current = false;
      },
      isCurrent: () => current,
      replacementRequestId: () => null,
      onTerminal: (_, _) async {},
    );

    await expectLater(
      resumed,
      throwsA(
        isA<RitoNavigationSupersededException>()
            .having((error) => error.requestId, 'requestId', 40)
            .having(
              (error) => error.replacementRequestId,
              'replacementRequestId',
              isNull,
            ),
      ),
    );
    expect(attempts, 0);
  });

  test('new foreground intent supersedes an active retained turn', () async {
    const driver = RitoPendingAdjacentDriver(maxContinuationQuanta: 8);
    var current = true;
    var attempts = 0;

    final resumed = driver.resume(
      initialRequest: _request(50),
      requestOneQuantum: (_) async {
        attempts += 1;
        current = false;
        throw const RitoNativeException(
          status: ritoNativeStatusAdjacentPending,
          message: 'superseded after native quantum',
        );
      },
      yieldHostTurn: () async {},
      isCurrent: () => current,
      replacementRequestId: () => 99,
      onTerminal: (_, _) async {},
    );

    await expectLater(
      resumed,
      throwsA(
        isA<RitoNavigationSupersededException>()
            .having((error) => error.requestId, 'requestId', 51)
            .having(
              (error) => error.replacementRequestId,
              'replacementRequestId',
              99,
            ),
      ),
    );
    expect(attempts, 1);
  });
}

RitoAdjacentRequest _request(int requestId) {
  return RitoAdjacentRequest(
    sessionId: 91,
    requestId: requestId,
    fromArtifactId: 7001,
    direction: RitoAdjacentDirection.next,
  );
}

RitoArtifact _artifact({required int requestId}) {
  return const RitoArtifactDecoder().decode(
    artifactFixture(
      requestId: requestId,
      artifactId: 7002,
      locatorHref: 'chapter-5.xhtml',
      localPageIndex: 0,
    ),
  );
}
