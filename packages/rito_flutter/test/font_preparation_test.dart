import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'open does not expose the first artifact before fonts are ready',
    () async {
      final gateway = _FontGateway();
      final registrar = _ControlledRegistrar();
      final open = RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: registrar),
      );
      var completed = false;
      unawaited(
        open.then<void>((_) {
          completed = true;
        }),
      );

      await registrar.started.future;
      expect(completed, isFalse);
      expect(gateway.resourceReads, 1);
      expect(gateway.foregroundHandoffs, isEmpty);

      registrar.complete();
      final session = await open;
      expect(completed, isTrue);
      expect(session.firstArtifact.artifactId, 7001);
      expect(gateway.foregroundHandoffs, hasLength(1));
      await session.dispose();
    },
  );

  test(
    'configured resources finish before initial foreground adoption',
    () async {
      final gateway = _FontGateway();
      final started = Completer<void>();
      final complete = Completer<void>();
      final open = RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: _CountingRegistrar()),
        resourcePreparer:
            ({
              required RitoArtifact artifact,
              required RitoArtifactResourceReader readResource,
            }) async {
              expect(artifact.artifactId, 7001);
              expect(readResource, isA<RitoArtifactResourceReader>());
              started.complete();
              await complete.future;
            },
      );

      await started.future;
      expect(gateway.foregroundHandoffs, isEmpty);
      complete.complete();
      final session = await open;
      expect(gateway.foregroundHandoffs, hasLength(1));
      await session.dispose();
    },
  );

  test(
    'same immutable face is read and registered once across turns',
    () async {
      final gateway = _FontGateway();
      final registrar = _CountingRegistrar();
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: registrar),
      );

      final next = await session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: _work,
      );

      expect(registrar.calls, 1);
      expect(gateway.resourceReads, 1);
      expect(gateway.releasedArtifactIds, isEmpty);
      await session.releaseArtifact(session.firstArtifact);
      expect(gateway.releasedArtifactIds, <int>[7001]);
      await expectLater(
        session.releaseArtifact(next),
        throwsA(isA<StateError>()),
      );
      await session.dispose();
    },
  );

  test('turn font failure releases only the new animation artifact', () async {
    final gateway = _FontGateway(
      nextFingerprint: 'shape-v2',
      nextFontHref: 'fonts/serif-v2.woff2',
    );
    final registrar = _FailSecondRegistrar();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: RitoArtifactFontCache(registrar: registrar),
    );

    await expectLater(
      session.turn(
        from: session.firstArtifact,
        requestId: 13,
        direction: RitoAdjacentDirection.next,
        work: _work,
      ),
      throwsA(isA<StateError>()),
    );

    expect(session.isDisposed, isFalse);
    expect(gateway.releasedArtifactIds, <int>[7002]);
    await expectLater(
      session.releaseArtifact(session.firstArtifact),
      throwsA(isA<StateError>()),
    );
    expect(gateway.releasedArtifactIds, <int>[7002]);
    await session.dispose();
  });

  test(
    'failed new-artifact cleanup fail-closes without retaining an orphan',
    () async {
      final gateway = _FontGateway(
        nextFingerprint: 'shape-v2',
        nextFontHref: 'fonts/serif-v2.woff2',
        failReleaseArtifactId: 7002,
      );
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: _FailSecondRegistrar()),
      );

      await expectLater(
        session.turn(
          from: session.firstArtifact,
          requestId: 13,
          direction: RitoAdjacentDirection.next,
          work: _work,
        ),
        throwsA(isA<RitoNativeSessionInvalidatedException>()),
      );

      expect(gateway.releaseAttempts, <int>[7002]);
      expect(gateway.disposals, 1);
      expect(session.isDisposed, isTrue);
      await expectLater(
        session.releaseArtifact(session.firstArtifact),
        throwsA(isA<RitoNativeSessionInvalidatedException>()),
      );
      expect(gateway.releaseAttempts, <int>[7002]);
      await session.dispose();
    },
  );

  test('failed registration is evicted and a later open retries', () async {
    final registrar = _FailOnceRegistrar();
    final cache = RitoArtifactFontCache(registrar: registrar);
    final firstGateway = _FontGateway();

    await expectLater(
      RitoReaderSession.open(
        gateway: firstGateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: cache,
      ),
      throwsA(isA<StateError>()),
    );
    expect(firstGateway.disposals, 1);
    expect(firstGateway.foregroundHandoffs, isEmpty);

    final secondGateway = _FontGateway();
    final session = await RitoReaderSession.open(
      gateway: secondGateway,
      publicationBytes: Uint8List.fromList(<int>[1]),
      request: _request(12),
      fontCache: cache,
    );
    expect(registrar.calls, 2);
    expect(secondGateway.resourceReads, 1);
    await session.dispose();
  });

  test(
    'font byte mismatch fails closed and disposes the opening session',
    () async {
      final gateway = _FontGateway(fontByteDelta: -1);
      final registrar = _CountingRegistrar();

      await expectLater(
        RitoReaderSession.open(
          gateway: gateway,
          publicationBytes: Uint8List.fromList(<int>[1]),
          request: _request(12),
          fontCache: RitoArtifactFontCache(registrar: registrar),
        ),
        throwsA(isA<FormatException>()),
      );

      expect(registrar.calls, 0);
      expect(gateway.disposals, 1);
    },
  );

  test('resource href mismatch fails before font registration', () async {
    final gateway = _FontGateway(returnedHref: 'fonts/wrong.woff2');
    final registrar = _CountingRegistrar();

    await expectLater(
      RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: registrar),
      ),
      throwsA(isA<StateError>()),
    );

    expect(registrar.calls, 0);
    expect(gateway.disposals, 1);
  });

  test(
    'font preparation keeps resource reads to four concurrent owners',
    () async {
      final base = const RitoArtifactDecoder().decode(artifactFixture());
      final fonts = List<RitoFontRef>.generate(
        12,
        (index) => RitoFontRef(
          family: 'Bounded $index',
          href: 'fonts/bounded-$index.ttf',
          style: 'normal',
          weight: 400,
          shapeFingerprint: 'bounded-$index',
          byteLength: 1,
        ),
      );
      final artifact = _withFonts(base, fonts);
      var activeReads = 0;
      var peakReads = 0;

      await RitoArtifactFontCache(registrar: _CountingRegistrar()).prepare(
        artifact: artifact,
        readResource: (reference) async {
          activeReads += 1;
          peakReads = peakReads < activeReads ? activeReads : peakReads;
          await Future<void>.delayed(Duration.zero);
          activeReads -= 1;
          return RitoResource(
            artifactId: artifact.artifactId,
            kind: RitoResourceKind.font,
            href: reference.href,
            mediaType: 'font/ttf',
            bytes: Uint8List.fromList(<int>[0]),
          );
        },
      );

      expect(peakReads, 4);
    },
  );

  test('overlapping artifact preparation shares one four-font cap', () async {
    final base = const RitoArtifactDecoder().decode(artifactFixture());
    List<RitoFontRef> fonts(String prefix) => List<RitoFontRef>.generate(
      6,
      (index) => RitoFontRef(
        family: '$prefix $index',
        href: 'fonts/$prefix-$index.ttf',
        style: 'normal',
        weight: 400,
        shapeFingerprint: '$prefix-$index',
        byteLength: 1,
      ),
    );
    final first = _withFonts(base, fonts('first'), artifactId: 8001);
    final second = _withFonts(base, fonts('second'), artifactId: 8002);
    final gate = Completer<void>();
    var activeReads = 0;
    var peakReads = 0;
    Future<RitoResource> read(
      RitoArtifact artifact,
      RitoResourceRef reference,
    ) async {
      activeReads += 1;
      peakReads = peakReads < activeReads ? activeReads : peakReads;
      await gate.future;
      activeReads -= 1;
      return RitoResource(
        artifactId: artifact.artifactId,
        kind: RitoResourceKind.font,
        href: reference.href,
        mediaType: 'font/ttf',
        bytes: Uint8List.fromList(<int>[0]),
      );
    }

    final cache = RitoArtifactFontCache(registrar: _CountingRegistrar());
    final preparations = <Future<RitoPreparedArtifact>>[
      cache.prepare(
        artifact: first,
        readResource: (reference) => read(first, reference),
      ),
      cache.prepare(
        artifact: second,
        readResource: (reference) => read(second, reference),
      ),
    ];
    await Future<void>.delayed(Duration.zero);

    expect(peakReads, 4);
    gate.complete();
    await Future.wait(preparations);
  });

  test('font without an owned resource fails before resource I/O', () async {
    final gateway = _FontGateway(includeFontResource: false);
    final registrar = _CountingRegistrar();

    await expectLater(
      RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(registrar: registrar),
      ),
      throwsA(isA<FormatException>()),
    );

    expect(gateway.resourceReads, 0);
    expect(registrar.calls, 0);
    expect(gateway.disposals, 1);
  });

  test('default registrar rejects WOFF2 before page paint', () async {
    final gateway = _FontGateway(
      fontBytePrefix: const <int>[0x77, 0x4f, 0x46, 0x32],
    );

    await expectLater(
      RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(<int>[1]),
        request: _request(12),
        fontCache: RitoArtifactFontCache(),
      ),
      throwsA(
        isA<UnsupportedError>().having(
          (error) => error.message,
          'message',
          contains('native SFNT bytes'),
        ),
      ),
    );

    expect(gateway.disposals, 1);
  });
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
    locator: const RitoLocator(href: 'chapter-4.xhtml'),
    work: _work,
  );
}

RitoArtifact _withFonts(
  RitoArtifact source,
  List<RitoFontRef> fonts, {
  int? artifactId,
}) {
  return RitoArtifact(
    protocolVersion: source.protocolVersion,
    capabilityProfileId: source.capabilityProfileId,
    sessionId: source.sessionId,
    requestId: source.requestId,
    revisionId: source.revisionId,
    revisionVersion: source.revisionVersion,
    artifactId: artifactId ?? source.artifactId,
    locator: source.locator,
    matchedBy: source.matchedBy,
    localPageIndex: source.localPageIndex,
    localSpreadIndex: source.localSpreadIndex,
    localPageIndexes: source.localPageIndexes,
    width: source.width,
    height: source.height,
    terminalExtent: source.terminalExtent,
    navigation: source.navigation,
    textProfile: source.textProfile,
    displayList: source.displayList,
    resources: fonts
        .map(
          (font) =>
              RitoResourceRef(kind: RitoResourceKind.font, href: font.href),
        )
        .toList(growable: false),
    fonts: fonts,
    pages: source.pages,
  );
}

final class _FontGateway implements RitoReaderGateway {
  _FontGateway({
    String nextFingerprint = 'shape-v1',
    String nextFontHref = 'fonts/serif.woff2',
    bool includeFontResource = true,
    this.failReleaseArtifactId,
    this.fontBytePrefix = const <int>[],
    this.fontByteDelta = 0,
    this.returnedHref,
  }) : first = const RitoArtifactDecoder().decode(
         artifactFixture(includeFontResource: includeFontResource),
       ),
       next = const RitoArtifactDecoder().decode(
         artifactFixture(
           requestId: 13,
           artifactId: 7002,
           fontFingerprint: nextFingerprint,
           fontHref: nextFontHref,
         ),
       );

  final RitoArtifact first;
  final RitoArtifact next;
  final int fontByteDelta;
  final List<int> fontBytePrefix;
  final int? failReleaseArtifactId;
  final String? returnedHref;
  final List<int> releasedArtifactIds = <int>[];
  final List<int> releaseAttempts = <int>[];
  int resourceReads = 0;
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
  }) async => next;

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) async => next;

  @override
  Future<RitoPublication> readPublication({required int sessionId}) async {
    return RitoPublication(
      protocolVersion: 1,
      sessionId: sessionId,
      metadata: const RitoPublicationMetadata(
        title: 'Font fixture',
        language: 'en',
        identifier: 'font-fixture',
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
    final candidate = handoff.candidateArtifactId == first.artifactId
        ? first
        : next;
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
  Future<RitoTextRangeGeometry> textRangeGeometry({
    required RitoTextRangeRequest request,
  }) async {
    throw UnimplementedError('text geometry is out of scope for this fake');
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
    resourceReads += 1;
    final artifact = artifactId == first.artifactId ? first : next;
    final font = artifact.fonts.firstWhere(
      (candidate) => candidate.href == href,
    );
    final bytes = Uint8List(font.byteLength + fontByteDelta);
    bytes.setRange(0, fontBytePrefix.length, fontBytePrefix);
    return RitoResource(
      artifactId: artifactId,
      kind: kind,
      href: returnedHref ?? href,
      mediaType: 'font/woff2',
      bytes: bytes,
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
  }
}

final class _ControlledRegistrar implements RitoFontRegistrar {
  final Completer<void> started = Completer<void>();
  final Completer<void> _completion = Completer<void>();

  void complete() => _completion.complete();

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) {
    started.complete();
    return _completion.future;
  }
}

class _CountingRegistrar implements RitoFontRegistrar {
  int calls = 0;

  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    calls += 1;
  }
}

final class _FailSecondRegistrar extends _CountingRegistrar {
  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    await super.register(font, bytes);
    if (calls == 2) {
      throw StateError('second font failed');
    }
  }
}

final class _FailOnceRegistrar extends _CountingRegistrar {
  @override
  Future<void> register(RitoFontRef font, Uint8List bytes) async {
    await super.register(font, bytes);
    if (calls == 1) {
      throw StateError('first font failed');
    }
  }
}
