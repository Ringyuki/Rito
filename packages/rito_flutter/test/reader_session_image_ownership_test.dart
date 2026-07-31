import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('CAS waits for images and old/new animation leases coexist', () async {
    const href = 'images/shared.png';
    const spec = TestImageSpec(code: 1, width: 400, height: 200);
    final first = imageArtifact(
      artifactId: 7001,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href, width: 100, height: 50)],
    );
    final next = imageArtifact(
      artifactId: 7002,
      requestId: 13,
      hrefs: const <String>[href],
      commands: <RitoCommand>[directImage(href, width: 100, height: 50)],
    );
    final decoder = TestImageDecoder(const <TestImageSpec>[spec]);
    final gateway = _ImageGateway(
      first: first,
      next: next,
      specs: const <String, TestImageSpec>{href: spec},
      beforeAdopt: (_) => expect(decoder.decodedCodes, isNotEmpty),
    );
    final cache = RitoArtifactImageCache(decoder: decoder, targetBucketSize: 1);
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: Uint8List.fromList(const <int>[1]),
      request: _request(12),
      imageCache: cache,
      imagePixelRatio: 2,
    );
    final oldImage = session.firstArtifact.resolveImage(href);
    expect(
      () => session.firstArtifact.resolveImage('images/unprepared.png'),
      throwsStateError,
    );
    await expectLater(
      session.releaseArtifact(session.firstArtifact),
      throwsStateError,
    );
    expect(gateway.releasedArtifactIds, isEmpty);
    final incoming = await session.turn(
      from: session.firstArtifact,
      requestId: 13,
      direction: RitoAdjacentDirection.next,
      work: _work,
    );

    expect(session.firstArtifact.hasPreparedImages, isTrue);
    expect(incoming.hasPreparedImages, isTrue);
    expect(identical(oldImage, incoming.resolveImage(href)), isTrue);
    expect(gateway.resourceReads, 1);
    expect(gateway.foregroundHandoffs, hasLength(2));
    await session.releaseArtifact(session.firstArtifact);
    expect(oldImage.debugDisposed, isFalse);
    await session.dispose();
    expect(oldImage.debugDisposed, isTrue);
    cache.dispose();
  });

  test(
    'failed candidate decode releases native candidate and keeps visible',
    () async {
      const firstHref = 'images/first.png';
      const nextHref = 'images/failed.png';
      const firstSpec = TestImageSpec(code: 1, width: 40, height: 40);
      const nextSpec = TestImageSpec(
        code: 2,
        width: 40,
        height: 40,
        failDecode: true,
      );
      final first = imageArtifact(
        artifactId: 7001,
        hrefs: const <String>[firstHref],
        commands: <RitoCommand>[directImage(firstHref)],
      );
      final next = imageArtifact(
        artifactId: 7002,
        requestId: 13,
        hrefs: const <String>[nextHref],
        commands: <RitoCommand>[directImage(nextHref)],
      );
      final decoder = TestImageDecoder(const <TestImageSpec>[
        firstSpec,
        nextSpec,
      ]);
      final gateway = _ImageGateway(
        first: first,
        next: next,
        specs: const <String, TestImageSpec>{
          firstHref: firstSpec,
          nextHref: nextSpec,
        },
      );
      final cache = RitoArtifactImageCache(decoder: decoder);
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: Uint8List.fromList(const <int>[1]),
        request: _request(12),
        imageCache: cache,
      );
      final visibleImage = session.firstArtifact.resolveImage(firstHref);

      await expectLater(
        session.turn(
          from: session.firstArtifact,
          requestId: 13,
          direction: RitoAdjacentDirection.next,
          work: _work,
        ),
        throwsStateError,
      );

      expect(session.visibleArtifactId, 7001);
      expect(gateway.releasedArtifactIds, <int>[7002]);
      expect(visibleImage.debugDisposed, isFalse);
      await session.dispose();
      expect(visibleImage.debugDisposed, isTrue);
      cache.dispose();
    },
  );
}

const _work = RitoWorkBudget(
  maxTopLevelNodesPerQuantum: 1,
  maxForegroundQuanta: 1,
  localPageCap: 2,
);

RitoArtifactRequest _request(int requestId) {
  return RitoArtifactRequest(
    sessionId: 91,
    requestId: requestId,
    layout: const RitoLayoutRequest(
      viewportWidth: 360,
      viewportHeight: 640,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      spreadMode: RitoSpreadMode.single,
      firstPageAlone: false,
      spreadGap: 0,
      rootFontSize: 16,
    ),
    locator: const RitoLocator(href: 'chapter.xhtml'),
    work: _work,
  );
}

final class _ImageGateway implements RitoReaderGateway {
  _ImageGateway({
    required this.first,
    required this.next,
    required this.specs,
    this.beforeAdopt,
  });

  final RitoArtifact first;
  final RitoArtifact next;
  final Map<String, TestImageSpec> specs;
  final void Function(RitoForegroundHandoff handoff)? beforeAdopt;
  final List<RitoForegroundHandoff> foregroundHandoffs =
      <RitoForegroundHandoff>[];
  final List<int> releasedArtifactIds = <int>[];
  int resourceReads = 0;
  int? _visibleArtifactId;
  int? _visibleRequestId;

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
  Future<RitoForegroundHandoffAck> adoptForeground({
    required RitoForegroundHandoff handoff,
  }) async {
    beforeAdopt?.call(handoff);
    foregroundHandoffs.add(handoff);
    final artifact = handoff.candidateArtifactId == first.artifactId
        ? first
        : next;
    final replaced = _visibleArtifactId;
    _visibleArtifactId = artifact.artifactId;
    _visibleRequestId = artifact.requestId;
    return RitoForegroundHandoffAck(
      intentRequestId: artifact.requestId,
      replacedArtifactId: replaced,
      visibleArtifactId: artifact.artifactId,
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
    return imageResource(
      artifact: artifact,
      reference: RitoResourceRef(kind: kind, href: href),
      spec: specs[href]!,
    );
  }

  @override
  Future<void> releaseArtifact({
    required int sessionId,
    required int artifactId,
  }) async {
    releasedArtifactIds.add(artifactId);
  }

  @override
  Future<void> dispose({required int sessionId}) async {}

  @override
  Future<RitoPublication> readPublication({required int sessionId}) async {
    return RitoPublication(
      protocolVersion: 1,
      sessionId: sessionId,
      metadata: const RitoPublicationMetadata(
        title: 'Images',
        language: 'en',
        identifier: 'images',
      ),
      spine: const <RitoPublicationSpineItem>[],
      toc: const <RitoPublicationTocEntry>[],
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
}
