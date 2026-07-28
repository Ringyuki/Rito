import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_native.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'request, resource, release, and dispose use the owned lifecycle',
    () async {
      final gateway = _MockGateway();
      final request = _request(12);
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1, 2, 3]),
        request: request,
        fontCache: _fontCache(),
      );

      final resource = await session.readResource(
        session.firstArtifact,
        session.firstArtifact.resources.firstWhere(
          (resource) => resource.kind == RitoResourceKind.image,
        ),
      );
      final next = await session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      );
      await session.releaseArtifact(session.firstArtifact);
      await session.releaseArtifact(session.firstArtifact);
      await session.dispose();
      await session.dispose();

      expect(resource.bytes, <int>[1, 2, 3, 4]);
      expect(resource.href, '../Images/cover.png');
      expect(gateway.lastResourceHref, '../Images/cover.png');
      expect(gateway.opens, 1);
      expect(gateway.requests, 0);
      expect(gateway.adjacentRequests, 1);
      expect(gateway.resourceReads, 2);
      expect(gateway.releases, 1);
      expect(gateway.disposals, 1);
      expect(session.isDisposed, isTrue);
    },
  );

  test(
    'concurrent and repeated dispose retain one observable failed future',
    () async {
      final disposeGate = Completer<void>();
      final disposeError = StateError('native dispose failed');
      final gateway = _MockGateway(delayedDispose: disposeGate.future);
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: _fontCache(),
      );

      final first = session.dispose();
      final concurrent = session.dispose();
      expect(identical(first, concurrent), isTrue);
      expect(session.isDisposed, isTrue);
      final firstFailure = expectLater(first, throwsA(same(disposeError)));
      final concurrentFailure = expectLater(
        concurrent,
        throwsA(same(disposeError)),
      );

      disposeGate.completeError(disposeError);
      await firstFailure;
      await concurrentFailure;

      final repeated = session.dispose();
      expect(identical(first, repeated), isTrue);
      await expectLater(repeated, throwsA(same(disposeError)));
      await expectLater(
        session.requestArtifact(_request(13)),
        throwsA(same(disposeError)),
      );
      expect(gateway.disposals, 1);
    },
  );

  test('initial candidate is adopted only after preparation', () async {
    final gateway = _MockGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    expect(gateway.foregroundHandoffs, hasLength(1));
    expect(gateway.foregroundHandoffs.single.expectedVisibleArtifactId, isNull);
    expect(gateway.foregroundHandoffs.single.candidateArtifactId, 7001);
    expect(session.visibleArtifactId, 7001);
    await session.dispose();
  });

  test('adjacent CAS retains the replaced artifact for animation', () async {
    final gateway = _MockGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    final next = await session.turn(
      from: session.firstArtifact,
      requestId: 13,
      direction: RitoAdjacentDirection.next,
      work: testWorkBudget,
    );

    expect(gateway.foregroundHandoffs, hasLength(2));
    expect(gateway.foregroundHandoffs.last.expectedVisibleArtifactId, 7001);
    expect(gateway.foregroundHandoffs.last.candidateArtifactId, 7002);
    expect(session.visibleArtifactId, 7002);
    expect(gateway.releases, 0);
    await session.releaseArtifact(session.firstArtifact);
    expect(gateway.releases, 1);
    await expectLater(
      session.releaseArtifact(next),
      throwsA(isA<StateError>()),
    );
    await session.dispose();
  });

  test('stale foreground CAS releases only the candidate', () async {
    final gateway = _MockGateway(
      replacementForegroundError: const RitoNativeException(
        status: 5,
        message: 'visible CAS is stale',
      ),
    );
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(isA<RitoNativeException>()),
    );
    expect(session.visibleArtifactId, 7001);
    expect(gateway.releases, 1);
    expect(session.isDisposed, isFalse);
    await session.dispose();
  });

  test('exact and adjacent mutation invalidations terminalize the session', () async {
    const invalidation = RitoNativeSessionInvalidatedException(
      sessionId: 91,
      requestId: 13,
      cleanupError: 'mutation acknowledgement was lost',
    );
    final exactGateway = _MockGateway(requestArtifactError: invalidation);
    final exactSession = await RitoReaderSession.open(
      gateway: exactGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    await expectLater(
      exactSession.requestArtifact(_request(13)),
      throwsA(same(invalidation)),
    );
    await expectLater(
      exactSession.advanceBackground(maxTopLevelNodesPerQuantum: 8),
      throwsA(same(invalidation)),
    );
    expect(exactGateway.disposals, 1);

    final adjacentGateway = _MockGateway(adjacentError: invalidation);
    final adjacentSession = await RitoReaderSession.open(
      gateway: adjacentGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await expectLater(
      adjacentSession.turn(
        from: adjacentSession.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(same(invalidation)),
    );
    await expectLater(
      adjacentSession.requestArtifact(_request(14)),
      throwsA(same(invalidation)),
    );
    expect(adjacentGateway.disposals, 1);
  });

  test('foreground adoption ambiguity terminalizes without candidate release', () async {
    const invalidation = RitoNativeSessionInvalidatedException(
      sessionId: 91,
      requestId: 13,
      cleanupError: 'foreground CAS acknowledgement was lost',
    );
    final gateway = _MockGateway(
      replacementForegroundError: invalidation,
    );
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(same(invalidation)),
    );
    expect(gateway.releases, 0);
    expect(gateway.disposals, 1);
    expect(session.isDisposed, isTrue);
  });

  test('background advance and adoption ambiguity terminalize locally', () async {
    const invalidation = RitoNativeSessionInvalidatedException(
      sessionId: 91,
      requestId: 12,
      cleanupError: 'background mutation acknowledgement was lost',
    );
    final advanceGateway = _MockGateway(
      backgroundAdvanceError: invalidation,
    );
    final advanceSession = await RitoReaderSession.open(
      gateway: advanceGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await expectLater(
      advanceSession.advanceBackground(maxTopLevelNodesPerQuantum: 8),
      throwsA(same(invalidation)),
    );
    expect(advanceGateway.disposals, 1);

    final adoptGateway = _MockGateway(
      provideBackgroundCandidate: true,
      backgroundAdoptError: invalidation,
    );
    final adoptSession = await RitoReaderSession.open(
      gateway: adoptGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    final prepared = await adoptSession.advanceBackground(
      maxTopLevelNodesPerQuantum: 8,
    );
    await expectLater(
      adoptSession.adoptBackground(prepared),
      throwsA(same(invalidation)),
    );
    expect(adoptGateway.releases, 0);
    expect(adoptGateway.disposals, 1);
  });

  test('release transport ambiguity never resurrects a native artifact', () async {
    final releaseFailure = StateError('release acknowledgement was lost');
    final invalidation = RitoNativeSessionInvalidatedException(
      sessionId: 91,
      requestId: 12,
      cleanupError: releaseFailure,
    );
    final gateway = _MockGateway(releaseError: invalidation);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await session.turn(
      from: session.firstArtifact,
      requestId: 13,
      direction: RitoAdjacentDirection.next,
      work: testWorkBudget,
    );

    await expectLater(
      session.releaseArtifact(session.firstArtifact),
      throwsA(same(invalidation)),
    );
    expect(gateway.releases, 1);
    expect(gateway.disposals, 1);
    expect(session.isDisposed, isTrue);
  });

  test('terminal read failures latch before the actor can become not-found', () async {
    const invalidation = RitoNativeSessionInvalidatedException(
      sessionId: 91,
      requestId: 12,
      cleanupError: 'reader actor ended before the read reply',
    );
    final publicationGateway = _MockGateway(
      publicationError: invalidation,
    );
    final publicationSession = await RitoReaderSession.open(
      gateway: publicationGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await expectLater(
      publicationSession.readPublication(),
      throwsA(same(invalidation)),
    );
    expect(publicationGateway.disposals, 1);

    final resourceGateway = _MockGateway();
    final resourceSession = await RitoReaderSession.open(
      gateway: resourceGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    resourceGateway.resourceError = invalidation;
    final image = resourceSession.firstArtifact.resources.firstWhere(
      (resource) => resource.kind == RitoResourceKind.image,
    );
    await expectLater(
      resourceSession.readResource(resourceSession.firstArtifact, image),
      throwsA(same(invalidation)),
    );
    expect(resourceGateway.disposals, 1);
  });

  test('publication and background candidate remain explicitly adopted', () async {
    final gateway = _MockGateway(provideBackgroundCandidate: true);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    final publication = await session.readPublication();
    final advance = await session.advanceBackground(
      maxTopLevelNodesPerQuantum: 8,
    );
    expect(publication.metadata.title, 'Fixture');
    expect(advance.artifact?.artifactId, 7003);
    expect(session.visibleArtifactId, 7001);

    final ack = await session.adoptBackground(advance);
    expect(ack.replacedArtifactId, 7001);
    expect(ack.visibleArtifactId, 7003);
    expect(session.visibleArtifactId, 7003);
    expect(gateway.backgroundRequests, hasLength(1));
    expect(gateway.backgroundHandoffs, hasLength(1));
    await expectLater(
      session.adoptBackground(advance),
      throwsA(isA<StateError>()),
    );
    expect(gateway.backgroundHandoffs, hasLength(1));
    expect(gateway.releases, 0);
    await session.releaseArtifact(session.firstArtifact);
    await session.dispose();
  });

  test('RITOREQ1 uses fixed-width header and total length', () {
    final bytes = const RitoRequestEncoder().encode(_request(12));
    expect(String.fromCharCodes(bytes.take(8)), 'RITOREQ1');
    expect(ByteData.sublistView(bytes, 8, 12).getUint32(0, Endian.little), 1);
    expect(
      ByteData.sublistView(bytes, 12, 20).getUint64(0, Endian.little),
      bytes.length,
    );
  });

  test('RITONAV1 is exact fixed-width little-endian and validates IDs', () {
    const encoder = RitoRequestEncoder();
    final bytes = encoder.encodeAdjacent(
      const RitoAdjacentRequest(
        sessionId: 91,
        requestId: 13,
        fromArtifactId: 7001,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
    );
    expect(bytes.length, 60);
    expect(String.fromCharCodes(bytes.take(8)), 'RITONAV1');
    expect(ByteData.sublistView(bytes, 8, 12).getUint32(0, Endian.little), 1);
    expect(ByteData.sublistView(bytes, 12, 20).getUint64(0, Endian.little), 60);
    expect(ByteData.sublistView(bytes, 20, 28).getUint64(0, Endian.little), 91);
    expect(ByteData.sublistView(bytes, 28, 36).getUint64(0, Endian.little), 13);
    expect(
      ByteData.sublistView(bytes, 36, 44).getUint64(0, Endian.little),
      7001,
    );
    expect(ByteData.sublistView(bytes, 44, 48).getUint32(0, Endian.little), 1);

    expect(
      () => encoder.encodeAdjacent(
        const RitoAdjacentRequest(
          sessionId: 0,
          requestId: 13,
          fromArtifactId: 7001,
          direction: RitoAdjacentDirection.next,
          work: testWorkBudget,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => encoder.encodeAdjacent(
        const RitoAdjacentRequest(
          sessionId: 0x8000000000000000,
          requestId: 13,
          fromArtifactId: 7001,
          direction: RitoAdjacentDirection.next,
          work: testWorkBudget,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
  });

  test(
    'adjacent lifecycle rejects released sources and disposed sessions',
    () async {
      final gateway = _MockGateway();
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: _fontCache(),
      );
      await expectLater(
        session.releaseArtifact(session.firstArtifact),
        throwsA(isA<StateError>()),
      );
      final next = await session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      );
      await session.releaseArtifact(session.firstArtifact);
      await expectLater(
        session.turn(
          from: session.firstArtifact,
          requestId: 14,
          direction: RitoAdjacentDirection.next,
          work: testWorkBudget,
        ),
        throwsA(isA<ArgumentError>()),
      );
      expect(next.artifactId, 7002);
      await session.dispose();
      await expectLater(
        session.requestAdjacent(
          const RitoAdjacentRequest(
            sessionId: 91,
            requestId: 14,
            fromArtifactId: 7001,
            direction: RitoAdjacentDirection.previous,
            work: testWorkBudget,
          ),
        ),
        throwsA(isA<StateError>()),
      );
    },
  );

  test('identity failures release or dispose native ownership', () async {
    final openMismatch = _MockGateway(openRequestId: 99);
    await expectLater(
      RitoReaderSession.open(
        gateway: openMismatch,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: _fontCache(),
      ),
      throwsA(isA<StateError>()),
    );
    expect(openMismatch.disposals, 1);

    final adjacentMismatch = _MockGateway(adjacentRequestId: 99);
    final session = await RitoReaderSession.open(
      gateway: adjacentMismatch,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(isA<StateError>()),
    );
    expect(adjacentMismatch.releases, 1);
    await session.dispose();
  });

  test(
    'resumed exact open exposes only its real artifact and request baseline',
    () async {
      final gateway = _ResumableMockGateway();
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: _fontCache(),
      );

      expect(session.firstArtifact.requestId, 15);
      expect(session.firstArtifact.artifact.locator.href, 'chapter-4.xhtml');
      expect(session.firstArtifact.artifact.localPageIndex, 7);
      expect(session.latestRequestId, 15);
      expect(session.nextRequestId, 16);
      await expectLater(
        session.requestArtifact(_request(15)),
        throwsA(isA<ArgumentError>()),
      );
      expect((await session.requestArtifact(_request(16))).requestId, 16);
      await session.dispose();
    },
  );

  test('resumed exact seek advances the public request baseline', () async {
    final gateway = _ResumableSeekGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    final sought = await session.requestArtifact(_request(13));

    expect(sought.requestId, 16);
    expect(session.latestRequestId, 16);
    expect(session.nextRequestId, 17);
    await session.dispose();
  });

  test('terminal resumed seek still records every consumed request ID', () async {
    final gateway = _ResumableSeekGateway(terminal: true);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    await expectLater(
      session.requestArtifact(_request(13)),
      throwsA(
        isA<RitoNativeException>().having(
          (error) => error.status,
          'status',
          ritoNativeStatusTargetNotPublishedV1,
        ),
      ),
    );

    expect(session.latestRequestId, 15);
    expect(session.nextRequestId, 16);
    await session.dispose();
  });

  test(
    'resumed adjacent prepares then adopts and advances request baseline',
    () async {
      final gateway = _ResumableAdjacentGateway();
      final preparedArtifactIds = <int>[];
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: _fontCache(),
        resourcePreparer:
            ({
              required RitoArtifact artifact,
              required RitoArtifactResourceReader readResource,
            }) async {
              expect(readResource, isA<RitoArtifactResourceReader>());
              preparedArtifactIds.add(artifact.artifactId);
            },
      );

      final turned = await session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      );

      expect(turned.requestId, 16);
      expect(session.latestRequestId, 16);
      expect(session.nextRequestId, 17);
      expect(preparedArtifactIds, <int>[7001, 7002]);
      expect(
        gateway.foregroundHandoffs
            .map((handoff) => handoff.candidateArtifactId),
        <int>[7001, 7002],
      );
      expect(gateway.foregroundHandoffs.last.expectedVisibleArtifactId, 7001);
      expect(gateway.releases, 0);
      await session.releaseArtifact(session.firstArtifact);
      expect(gateway.releases, 1);
      await session.dispose();
    },
  );

  test('terminal resumed adjacent records every internally consumed ID', () async {
    final gateway = _ResumableAdjacentGateway(terminal: true);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(
        isA<RitoNativeException>().having(
          (error) => error.status,
          'status',
          ritoNativeStatusTargetNotPublishedV1,
        ),
      ),
    );

    expect(session.latestRequestId, 15);
    expect(session.nextRequestId, 16);
    await session.dispose();
  });

  test('background work yields while a retained adjacent turn is active', () async {
    final gateway = _DelayedResumableAdjacentGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );

    final turning = session.turn(
      from: session.firstArtifact,
      requestId: 13,
      direction: RitoAdjacentDirection.next,
      work: testWorkBudget,
    );
    await expectLater(
      session.advanceBackground(maxTopLevelNodesPerQuantum: 8),
      throwsA(isA<StateError>()),
    );
    expect(gateway.backgroundRequests, isEmpty);

    gateway.completeAdjacent();
    expect((await turning).requestId, 16);
    await session.dispose();
  });

  test('native adjacent status remains typed and lossless', () async {
    const error = RitoNativeException(status: 6, message: 'not published');
    final gateway = _MockGateway(adjacentError: error);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: testWorkBudget,
      ),
      throwsA(
        isA<RitoNativeException>()
            .having((value) => value.status, 'status', 6)
            .having((value) => value.message, 'message', 'not published'),
      ),
    );
    await session.dispose();
  });

  test('a resource response completed after dispose is not exposed', () async {
    final resourceGate = Completer<RitoResource>();
    final gateway = _MockGateway(delayedImage: resourceGate.future);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: _fontCache(),
    );
    final image = session.firstArtifact.resources.firstWhere(
      (resource) => resource.kind == RitoResourceKind.image,
    );

    final read = session.readResource(session.firstArtifact, image);
    final dispose = session.dispose();
    resourceGate.complete(
      const RitoResourceDecoder().decode(
        resourceFixture(href: 'OEBPS/images/cover.png'),
      ),
    );

    await expectLater(read, throwsA(isA<StateError>()));
    await dispose;
  });
}

const RitoWorkBudget testWorkBudget = RitoWorkBudget(
  maxTopLevelNodesPerQuantum: 8,
  maxForegroundQuanta: 2,
  localPageCap: 16,
);

RitoArtifactFontCache _fontCache() {
  return RitoArtifactFontCache(registrar: const _NoopFontRegistrar());
}

final class _NoopFontRegistrar implements RitoFontRegistrar {
  const _NoopFontRegistrar();

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {}
}

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
    locator: RitoLocator(
      href: 'chapter-4.xhtml',
      sourcePoint: RitoSourcePoint(nodePath: <int>[1, 9, 2], textOffset: 47),
    ),
    work: testWorkBudget,
  );
}

final class _MockGateway implements RitoReaderGateway {
  _MockGateway({
    int openRequestId = 12,
    int adjacentRequestId = 13,
    this.adjacentError,
    this.delayedImage,
    this.delayedDispose,
    this.provideBackgroundCandidate = false,
    this.requestArtifactError,
    this.backgroundAdvanceError,
    this.backgroundAdoptError,
    this.releaseError,
    this.publicationError,
    this.resourceError,
    this.replacementForegroundError,
  }) : artifact = const RitoArtifactDecoder().decode(
         artifactFixture(requestId: openRequestId),
       ),
       nextArtifact = const RitoArtifactDecoder().decode(
         artifactFixture(requestId: adjacentRequestId, artifactId: 7002),
       ),
       backgroundArtifact = const RitoArtifactDecoder().decode(
         artifactFixture(requestId: openRequestId, artifactId: 7003),
       );

  final RitoArtifact artifact;
  final RitoArtifact nextArtifact;
  final RitoArtifact backgroundArtifact;
  final Object? adjacentError;
  final Future<RitoResource>? delayedImage;
  final Future<void>? delayedDispose;
  final bool provideBackgroundCandidate;
  final Object? requestArtifactError;
  final Object? backgroundAdvanceError;
  final Object? backgroundAdoptError;
  final Object? releaseError;
  final Object? publicationError;
  Object? resourceError;
  final Object? replacementForegroundError;
  int opens = 0;
  int requests = 0;
  int adjacentRequests = 0;
  int resourceReads = 0;
  int releases = 0;
  int disposals = 0;
  int publicationReads = 0;
  final List<RitoForegroundHandoff> foregroundHandoffs =
      <RitoForegroundHandoff>[];
  final List<RitoBackgroundRequest> backgroundRequests =
      <RitoBackgroundRequest>[];
  final List<RitoBackgroundHandoff> backgroundHandoffs =
      <RitoBackgroundHandoff>[];
  int? _visibleRequestId;
  String? lastResourceHref;

  @override
  Future<RitoArtifact> open({
    required Uint8List publicationBytes,
    required RitoArtifactRequest request,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) async {
    opens += 1;
    return artifact;
  }

  @override
  Future<RitoArtifact> requestArtifact({
    required RitoArtifactRequest request,
  }) async {
    requests += 1;
    final error = requestArtifactError;
    if (error != null) {
      throw error;
    }
    return nextArtifact;
  }

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) async {
    adjacentRequests += 1;
    if (adjacentError case final error?) {
      throw error;
    }
    return nextArtifact;
  }

  @override
  Future<RitoPublication> readPublication({required int sessionId}) async {
    publicationReads += 1;
    final error = publicationError;
    if (error != null) {
      throw error;
    }
    return RitoPublication(
      protocolVersion: 1,
      sessionId: sessionId,
      metadata: const RitoPublicationMetadata(
        title: 'Fixture',
        language: 'en',
        identifier: 'fixture-id',
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
    if (handoff.expectedVisibleArtifactId != null) {
      final error = replacementForegroundError;
      if (error != null) {
        throw error;
      }
    }
    final candidate = handoff.candidateArtifactId == artifact.artifactId
        ? artifact
        : nextArtifact;
    _visibleRequestId = candidate.requestId;
    return RitoForegroundHandoffAck(
      intentRequestId: candidate.requestId,
      replacedArtifactId: handoff.expectedVisibleArtifactId,
      visibleArtifactId: handoff.candidateArtifactId,
    );
  }

  @override
  Future<RitoBackgroundAdvance> advanceBackground({
    required RitoBackgroundRequest request,
  }) async {
    backgroundRequests.add(request);
    final error = backgroundAdvanceError;
    if (error != null) {
      throw error;
    }
    return RitoBackgroundAdvance(
      state: provideBackgroundCandidate
          ? RitoBackgroundState.reused
          : RitoBackgroundState.complete,
      intentRequestId: _visibleRequestId!,
      replacesArtifactId: request.expectedVisibleArtifactId,
      artifact: provideBackgroundCandidate ? backgroundArtifact : null,
    );
  }

  @override
  Future<RitoBackgroundHandoffAck> adoptBackground({
    required RitoBackgroundHandoff handoff,
  }) async {
    backgroundHandoffs.add(handoff);
    final error = backgroundAdoptError;
    if (error != null) {
      throw error;
    }
    _visibleRequestId = backgroundArtifact.requestId;
    return RitoBackgroundHandoffAck(
      intentRequestId: _visibleRequestId!,
      replacedArtifactId: handoff.expectedVisibleArtifactId,
      visibleArtifactId: handoff.candidateArtifactId,
    );
  }

  @override
  Future<RitoResource> readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) async {
    resourceReads += 1;
    lastResourceHref = href;
    final error = resourceError;
    if (error != null) {
      throw error;
    }
    if (kind == RitoResourceKind.font) {
      return const RitoResourceDecoder().decode(
        resourceFixture(
          kind: 1,
          href: href,
          mediaType: 'font/woff2',
          bytes: List<int>.filled(8192, 0x5a),
        ),
      );
    }
    final delayed = delayedImage;
    if (delayed != null) {
      return delayed;
    }
    return const RitoResourceDecoder().decode(resourceFixture(href: href));
  }

  @override
  Future<void> releaseArtifact({
    required int sessionId,
    required int artifactId,
  }) async {
    releases += 1;
    final error = releaseError;
    if (error != null) {
      throw error;
    }
  }

  @override
  Future<void> dispose({required int sessionId}) async {
    disposals += 1;
    final delayed = delayedDispose;
    if (delayed != null) {
      await delayed;
    }
  }
}

final class _ResumableMockGateway extends _MockGateway
    implements RitoResumableExactSeekGateway {
  _ResumableMockGateway()
    : super(openRequestId: 15, adjacentRequestId: 16);

  @override
  bool acceptsResumedExactSeekArtifact({
    required RitoArtifactRequest request,
    required RitoArtifact artifact,
  }) {
    return request.sessionId == artifact.sessionId &&
        request.requestId == 12 &&
        artifact.requestId == 15;
  }

  @override
  int? latestRequestIdForExactSeek({required RitoArtifactRequest request}) {
    return request.requestId == 12 ? 15 : null;
  }
}

final class _ResumableSeekGateway extends _MockGateway
    implements RitoResumableExactSeekGateway {
  _ResumableSeekGateway({this.terminal = false})
    : super(openRequestId: 12, adjacentRequestId: 16);

  final bool terminal;

  @override
  Future<RitoArtifact> requestArtifact({
    required RitoArtifactRequest request,
  }) async {
    requests += 1;
    if (terminal) {
      throw const RitoNativeException(
        status: ritoNativeStatusTargetNotPublishedV1,
        message: 'exact target is terminal',
      );
    }
    return nextArtifact;
  }

  @override
  bool acceptsResumedExactSeekArtifact({
    required RitoArtifactRequest request,
    required RitoArtifact artifact,
  }) {
    return request.requestId == 13 && artifact.requestId == 16;
  }

  @override
  int? latestRequestIdForExactSeek({required RitoArtifactRequest request}) {
    if (request.requestId != 13) {
      return null;
    }
    return terminal ? 15 : 16;
  }
}

final class _ResumableAdjacentGateway extends _MockGateway
    implements RitoResumableAdjacentGateway {
  _ResumableAdjacentGateway({this.terminal = false})
    : super(openRequestId: 12, adjacentRequestId: 16);

  final bool terminal;

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) async {
    adjacentRequests += 1;
    if (terminal) {
      throw const RitoNativeException(
        status: ritoNativeStatusTargetNotPublishedV1,
        message: 'retained adjacent reached its terminal extent',
      );
    }
    return nextArtifact;
  }

  @override
  bool acceptsResumedAdjacentArtifact({
    required RitoAdjacentRequest request,
    required RitoArtifact artifact,
  }) {
    return request.requestId == 13 &&
        request.fromArtifactId == 7001 &&
        request.direction == RitoAdjacentDirection.next &&
        request.work.localPageCap == testWorkBudget.localPageCap &&
        artifact.requestId == 16;
  }

  @override
  int? latestRequestIdForAdjacent({required RitoAdjacentRequest request}) {
    if (request.requestId != 13 ||
        request.fromArtifactId != 7001 ||
        request.direction != RitoAdjacentDirection.next ||
        request.work.localPageCap != testWorkBudget.localPageCap) {
      return null;
    }
    return terminal ? 15 : 16;
  }
}

final class _DelayedResumableAdjacentGateway extends _MockGateway
    implements RitoResumableAdjacentGateway {
  _DelayedResumableAdjacentGateway()
    : super(openRequestId: 12, adjacentRequestId: 16);

  final Completer<RitoArtifact> _adjacent = Completer<RitoArtifact>();

  void completeAdjacent() => _adjacent.complete(nextArtifact);

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) {
    adjacentRequests += 1;
    return _adjacent.future;
  }

  @override
  bool acceptsResumedAdjacentArtifact({
    required RitoAdjacentRequest request,
    required RitoArtifact artifact,
  }) {
    return request.requestId == 13 && artifact.requestId == 16;
  }

  @override
  int? latestRequestIdForAdjacent({required RitoAdjacentRequest request}) {
    return request.requestId == 13 ? 16 : null;
  }
}
