import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_native.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'pending open yields and advances one quantum until exact artifact ready',
    () async {
      const driver = RitoPendingExactSeekDriver(maxContinuationQuanta: 8);
      final requests = <RitoArtifactRequest>[];
      var hostYields = 0;
      var failClosedCalls = 0;
      var exposedArtifacts = 0;
      const pending = RitoNativeException(
        status: ritoNativeStatusExactSeekPendingV1,
        message: 'exact target is still pending',
      );

      final resumed = driver.resume(
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
          failClosedCalls += 1;
        },
      );
      unawaited(
        resumed.then<void>((_) {
          exposedArtifacts += 1;
        }),
      );
      final artifact = await resumed;

      expect(requests.map((request) => request.requestId), <int>[13, 14, 15]);
      expect(
        requests.map((request) => request.work.maxForegroundQuanta),
        everyElement(1),
      );
      expect(
        requests.map((request) => request.work.maxTopLevelNodesPerQuantum),
        everyElement(8),
      );
      expect(
        requests.map((request) => request.work.localPageCap),
        everyElement(16),
      );
      expect(
        requests.map((request) => request.layout),
        everyElement(same(_layout)),
      );
      expect(
        requests.map((request) => request.locator),
        everyElement(same(_locator)),
      );
      expect(
        requests.map((request) => request.textProfile),
        everyElement(RitoTextProfile.positionedGlyphRuns),
      );
      expect(hostYields, 3);
      expect(failClosedCalls, 0);
      expect(exposedArtifacts, 1);
      expect(artifact.requestId, 15);
      expect(artifact.locator.href, 'chapter-4.xhtml');
      expect(artifact.localPageIndex, 7);
    },
  );

  test(
    'pending continuation stops as soon as the exact target becomes terminal',
    () async {
      const driver = RitoPendingExactSeekDriver(maxContinuationQuanta: 8);
      const terminal = RitoNativeException(
        status: ritoNativeStatusTargetNotPublishedV1,
        message: 'message wording is not an adapter contract',
      );
      var attempts = 0;
      var failClosedCalls = 0;

      final resumed = driver.resume(
        initialRequest: _request(20),
        requestOneQuantum: (_) async {
          attempts += 1;
          if (attempts == 1) {
            throw const RitoNativeException(
              status: ritoNativeStatusExactSeekPendingV1,
              message: 'still pending',
            );
          }
          throw terminal;
        },
        yieldHostTurn: () async {},
        isCurrent: () => true,
        replacementRequestId: () => null,
        onTerminal: (_, _) async {
          failClosedCalls += 1;
        },
      );

      await expectLater(resumed, throwsA(same(terminal)));
      expect(attempts, 2);
      expect(failClosedCalls, 1);
    },
  );

  test('repeated subsequent pending has a finite fail-closed bound', () async {
    const driver = RitoPendingExactSeekDriver(maxContinuationQuanta: 3);
    final requestIds = <int>[];
    Object? cleanupError;

    final resumed = driver.resume(
      initialRequest: _request(30),
      requestOneQuantum: (request) async {
        requestIds.add(request.requestId);
        throw const RitoNativeException(
          status: ritoNativeStatusExactSeekPendingV1,
          message: 'continuation remains pending',
        );
      },
      yieldHostTurn: () async {},
      isCurrent: () => true,
      replacementRequestId: () => null,
      onTerminal: (error, _) async {
        cleanupError = error;
      },
    );

    await expectLater(
      resumed,
      throwsA(
        isA<RitoPendingExactSeekLimitException>()
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
    expect(cleanupError, isA<RitoPendingExactSeekLimitException>());
  });

  test(
    'dispose or cancel during the host yield performs no native retry',
    () async {
      const driver = RitoPendingExactSeekDriver(maxContinuationQuanta: 8);
      var current = true;
      var attempts = 0;
      var failClosedCalls = 0;

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
        onTerminal: (_, _) async {
          failClosedCalls += 1;
        },
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
      expect(failClosedCalls, 0);
    },
  );

  test(
    'new seek supersedes pending continuation with its request ID',
    () async {
      const driver = RitoPendingExactSeekDriver(maxContinuationQuanta: 8);
      var current = true;
      const replacementRequestId = 99;
      var attempts = 0;

      final resumed = driver.resume(
        initialRequest: _request(50),
        requestOneQuantum: (_) async {
          attempts += 1;
          current = false;
          throw const RitoNativeException(
            status: ritoNativeStatusExactSeekPendingV1,
            message: 'superseded while native work was active',
          );
        },
        yieldHostTurn: () async {},
        isCurrent: () => current,
        replacementRequestId: () => replacementRequestId,
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
    },
  );
}

const RitoLayoutRequest _layout = RitoLayoutRequest(
  viewportWidth: 360,
  viewportHeight: 640,
  marginTop: 16,
  marginRight: 16,
  marginBottom: 16,
  marginLeft: 16,
  spreadMode: RitoSpreadMode.single,
  firstPageAlone: false,
  spreadGap: 24,
  rootFontSize: 16,
);

const RitoLocator _locator = RitoLocator(
  href: 'chapter-4.xhtml',
  anchorId: 'paragraph-9',
  progression: .63,
);

RitoArtifactRequest _request(int requestId) {
  return RitoArtifactRequest(
    sessionId: 91,
    requestId: requestId,
    layout: _layout,
    locator: _locator,
    work: const RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 8,
      maxForegroundQuanta: 9,
      localPageCap: 16,
    ),
    textProfile: RitoTextProfile.positionedGlyphRuns,
  );
}

RitoArtifact _artifact({required int requestId}) {
  return const RitoArtifactDecoder().decode(
    artifactFixture(requestId: requestId),
  );
}
