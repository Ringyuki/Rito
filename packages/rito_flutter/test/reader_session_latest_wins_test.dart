import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'prepared stale artifact is released once before latest publishes',
    () async {
      final gateway = _NavigationGateway();
      final registrar = _NavigationRegistrar();
      final session = await _open(gateway, registrar);

      final stale = session.requestArtifact(_request(13));
      final staleFailure = expectLater(
        stale,
        throwsA(_superseded(requestId: 13, replacementRequestId: 14)),
      );
      await registrar.staleStarted.future;

      var latestPublished = false;
      final latest = session.requestArtifact(_request(14));
      unawaited(
        latest.then<void>((_) {
          latestPublished = true;
        }),
      );
      await Future<void>.delayed(Duration.zero);
      expect(latestPublished, isFalse);

      registrar.completeStale();
      await staleFailure;
      final prepared = await latest;

      expect(prepared.requestId, 14);
      expect(gateway.releaseAttempts, <int>[7002]);
      expect(gateway.releasedArtifactIds, <int>[7002]);
      expect(
        gateway.foregroundHandoffs.map(
          (handoff) => handoff.candidateArtifactId,
        ),
        <int>[7001, 7003],
      );
      await session.dispose();
    },
  );

  test(
    'failed active navigation does not block the latest publication',
    () async {
      final active = Completer<RitoArtifact>();
      final gateway = _NavigationGateway(delayedRequest13: active.future);
      final session = await _open(gateway, _NavigationRegistrar());

      final stale = session.requestArtifact(_request(13));
      final staleFailure = expectLater(stale, throwsStateError);
      final latest = session.requestArtifact(_request(14));

      active.completeError(StateError('active navigation failed'));
      await staleFailure;
      expect((await latest).requestId, 14);
      expect(gateway.releaseAttempts, isEmpty);
      await session.dispose();
    },
  );

  test(
    'stale release failure invalidates stale and latest when dispose fails',
    () async {
      final disposeError = StateError('dispose failed');
      final gateway = _NavigationGateway(
        failReleaseArtifactId: 7002,
        disposeError: disposeError,
      );
      final registrar = _NavigationRegistrar();
      final session = await _open(gateway, registrar);

      final stale = session.requestArtifact(_request(13));
      final staleFailure = expectLater(
        stale,
        throwsA(_invalidated(requestId: 13, includesDisposeFailure: true)),
      );
      await registrar.staleStarted.future;
      final latest = session.requestArtifact(_request(14));
      final latestFailure = expectLater(
        latest,
        throwsA(_invalidated(requestId: 13, includesDisposeFailure: true)),
      );

      registrar.completeStale();
      await staleFailure;
      await latestFailure;

      expect(gateway.releaseAttempts, <int>[7002]);
      expect(gateway.releasedArtifactIds, isEmpty);
      expect(gateway.disposals, 1);
      expect(session.isDisposed, isTrue);
      await expectLater(
        session.requestArtifact(_request(15)),
        throwsA(_invalidated(requestId: 13, includesDisposeFailure: true)),
      );
      final retainedDispose = session.dispose();
      await expectLater(retainedDispose, throwsA(same(disposeError)));
      expect(identical(retainedDispose, session.dispose()), isTrue);
      expect(gateway.disposals, 1);
    },
  );

  test(
    'failed preparation cleanup fail-closes without retaining an orphan',
    () async {
      final gateway = _NavigationGateway(failReleaseArtifactId: 7002);
      final session = await _open(gateway, const _FailingRegistrar(13));

      await expectLater(
        session.requestArtifact(_request(13)),
        throwsA(_invalidated(requestId: 13)),
      );

      expect(gateway.releaseAttempts, <int>[7002]);
      expect(gateway.releasedArtifactIds, isEmpty);
      expect(gateway.disposals, 1);
      expect(session.isDisposed, isTrue);
      await expectLater(
        session.requestArtifact(_request(14)),
        throwsA(_invalidated(requestId: 13)),
      );
      await session.dispose();
      expect(gateway.releaseAttempts, <int>[7002]);
      expect(gateway.disposals, 1);
    },
  );
}

Matcher _superseded({
  required int requestId,
  required int replacementRequestId,
}) {
  return isA<RitoNavigationSupersededException>()
      .having((error) => error.sessionId, 'sessionId', 91)
      .having((error) => error.requestId, 'requestId', requestId)
      .having(
        (error) => error.replacementRequestId,
        'replacementRequestId',
        replacementRequestId,
      );
}

Matcher _invalidated({
  required int requestId,
  bool includesDisposeFailure = false,
}) {
  var matcher = isA<RitoNativeSessionInvalidatedException>()
      .having((error) => error.sessionId, 'sessionId', 91)
      .having((error) => error.requestId, 'requestId', requestId)
      .having(
        (error) => error.cleanupError.toString(),
        'cleanupError',
        contains('release failed'),
      );
  if (includesDisposeFailure) {
    matcher = matcher.having(
      (error) => error.cleanupError.toString(),
      'disposeError',
      contains('dispose failed'),
    );
  }
  return matcher;
}

Future<RitoReaderSession> _open(
  _NavigationGateway gateway,
  RitoFontRegistrar registrar,
) {
  return RitoReaderSession.open(
    gateway: gateway,
    publicationBytes: Uint8List.fromList(<int>[1]),
    request: _request(12),
    fontCache: RitoArtifactFontCache(registrar: registrar),
  );
}

const _work = RitoWorkBudget(
  maxTopLevelNodesPerQuantum: 8,
  maxForegroundQuanta: 2,
  localPageCap: 16,
);

RitoArtifactRequest _request(int requestId) {
  return RitoArtifactRequest(
    sessionId: 91,
    requestId: requestId,
    layout: const RitoLayoutRequest(
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
    ),
    locator: RitoLocator(href: 'chapter-$requestId.xhtml'),
    work: _work,
  );
}

final class _NavigationGateway implements RitoReaderGateway {
  _NavigationGateway({
    this.delayedRequest13,
    this.failReleaseArtifactId,
    this.disposeError,
  }) : first = _artifact(requestId: 12, artifactId: 7001);

  final RitoArtifact first;
  final Future<RitoArtifact>? delayedRequest13;
  final int? failReleaseArtifactId;
  final Object? disposeError;
  final List<int> releaseAttempts = <int>[];
  final List<int> releasedArtifactIds = <int>[];
  int disposals = 0;
  int? _visibleRequestId;
  final List<RitoForegroundHandoff> foregroundHandoffs =
      <RitoForegroundHandoff>[];

  @override
  Future<RitoArtifact?> peekAdjacent({required RitoAdjacentRequest request}) {
    throw UnimplementedError('peekAdjacent is not exercised by this fake.');
  }

  @override
  Future<RitoForegroundHandoffAck> commitPeeked({
    required RitoForegroundHandoff handoff,
    required int intentRequestId,
  }) {
    throw UnimplementedError('commitPeeked is not exercised by this fake.');
  }

  @override
  Future<RitoArtifact> open({
    required Uint8List publicationBytes,
    required RitoArtifactRequest request,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) async => first;

  @override
  Future<RitoArtifact> requestArtifact({
    required RitoArtifactRequest request,
  }) async {
    if (request.requestId == 13 && delayedRequest13 != null) {
      return delayedRequest13!;
    }
    return _artifact(
      requestId: request.requestId,
      artifactId: 6989 + request.requestId,
    );
  }

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) async {
    return _artifact(
      requestId: request.requestId,
      artifactId: 6989 + request.requestId,
    );
  }

  @override
  Future<RitoPublication> readPublication({required int sessionId}) async {
    return RitoPublication(
      protocolVersion: 1,
      sessionId: sessionId,
      metadata: const RitoPublicationMetadata(
        title: 'Navigation fixture',
        language: 'en',
        identifier: 'navigation-fixture',
      ),
      spine: const <RitoPublicationSpineItem>[],
      toc: const <RitoPublicationTocEntry>[],
    );
  }

  @override
  Future<RitoForegroundHandoffAck> adoptForeground({
    required RitoForegroundHandoff handoff,
  }) async {
    foregroundHandoffs.add(handoff);
    final requestId = handoff.candidateArtifactId - 6989;
    _visibleRequestId = requestId;
    return RitoForegroundHandoffAck(
      intentRequestId: requestId,
      replacedArtifactId: handoff.expectedVisibleArtifactId,
      visibleArtifactId: handoff.candidateArtifactId,
    );
  }

  @override
  Future<RitoBackgroundAdvance> advanceBackground({
    required RitoBackgroundRequest request,
  }) async {
    return RitoBackgroundAdvance(
      state: RitoBackgroundState.complete,
      intentRequestId: _visibleRequestId!,
      replacesArtifactId: request.expectedVisibleArtifactId,
    );
  }

  @override
  Future<RitoBackgroundHandoffAck> adoptBackground({
    required RitoBackgroundHandoff handoff,
  }) async {
    return RitoBackgroundHandoffAck(
      intentRequestId: _visibleRequestId!,
      replacedArtifactId: handoff.expectedVisibleArtifactId,
      visibleArtifactId: handoff.candidateArtifactId,
    );
  }

  @override
  Future<RitoFootnote> readFootnote({
    required int sessionId,
    required int artifactId,
    required String key,
  }) async {
    throw UnimplementedError('footnotes are out of scope for this fake');
  }

  @override
  Future<RitoResource> readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) async {
    return RitoResource(
      artifactId: artifactId,
      kind: kind,
      href: href,
      mediaType: 'font/ttf',
      bytes: Uint8List(8192),
    );
  }

  @override
  Future<void> releaseArtifact({
    required int sessionId,
    required int artifactId,
  }) async {
    releaseAttempts.add(artifactId);
    if (artifactId == failReleaseArtifactId) {
      throw StateError('release failed');
    }
    releasedArtifactIds.add(artifactId);
  }

  @override
  Future<void> dispose({required int sessionId}) async {
    disposals += 1;
    if (disposeError case final error?) {
      throw error;
    }
  }
}

final class _NavigationRegistrar implements RitoFontRegistrar {
  final Completer<void> staleStarted = Completer<void>();
  final Completer<void> _staleCompletion = Completer<void>();

  void completeStale() => _staleCompletion.complete();

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    if (font.shapeFingerprint != 'shape-13') {
      return;
    }
    staleStarted.complete();
    await _staleCompletion.future;
  }
}

final class _FailingRegistrar implements RitoFontRegistrar {
  const _FailingRegistrar(this.requestId);

  final int requestId;

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    if (font.shapeFingerprint == 'shape-$requestId') {
      throw StateError('font preparation failed');
    }
  }
}

RitoArtifact _artifact({required int requestId, required int artifactId}) {
  return const RitoArtifactDecoder().decode(
    artifactFixture(
      requestId: requestId,
      artifactId: artifactId,
      fontFingerprint: 'shape-$requestId',
    ),
  );
}
