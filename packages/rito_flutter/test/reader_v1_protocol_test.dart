import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

import 'support/artifact_fixture.dart';
import 'support/publication_fixture.dart';
import 'support/reader_control_fixture.dart';

void main() {
  test('strictly decodes publication metadata, spine, and nested TOC', () {
    final publication = const RitoPublicationDecoder().decode(
      publicationFixture(),
    );

    expect(publication.protocolVersion, 1);
    expect(publication.sessionId, 91);
    expect(publication.metadata.title, 'Fixture book');
    expect(publication.metadata.creator, 'Rito');
    expect(publication.spine.length, 2);
    expect(publication.spine[1].linearIndex, 1);
    expect(publication.toc.length, 2);
    final first = publication.toc.first;
    expect(first.tocId, 0);
    expect(first.children.single.tocId, 1);
    expect(
      (first.target as RitoPublicationTocLocatorTarget).locator.anchorId,
      'start',
    );
    expect(
      first.children.single.target,
      isA<RitoPublicationTocExternalTarget>(),
    );
    expect(
      publication.toc[1].target,
      isA<RitoPublicationTocUnresolvedTarget>(),
    );
  });

  test('publication decoder enforces truncation, identity, and semantics', () {
    const decoder = RitoPublicationDecoder();
    _expectEveryPrefixRejected(
      publicationFixture(),
      (bytes) {
        decoder.decode(bytes);
      },
    );
    for (final malformed in <Uint8List>[
      publicationFixture(sessionId: 0),
      publicationFixture(sessionId: 0x8000000000000000),
      publicationFixture(firstSpineIndex: 1),
      publicationFixture(firstLinearIndex: 1),
      publicationFixture(firstTocId: 7),
      publicationFixture(firstTargetTag: 255),
      publicationFixture(locatorHref: 'wrong.xhtml'),
      publicationFixture(locatorHasProgression: true),
    ]) {
      expect(() => decoder.decode(malformed), throwsA(isA<FormatException>()));
    }
  });

  test('publication decoder enforces byte, TOC depth, and item caps', () {
    const decoder = RitoPublicationDecoder();
    decoder.decode(deepPublicationFixture(ritoPublicationMaxTocDepth));
    expect(
      () => decoder.decode(
        deepPublicationFixture(ritoPublicationMaxTocDepth + 1),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decode(
        publicationFixture(
          declaredRootTocCount: ritoPublicationMaxTocItems + 1,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decode(Uint8List(ritoPublicationMaxWireBytes + 1)),
      throwsA(isA<FormatException>()),
    );
  });

  test('background request and handoff encoders match Core fixed wire', () {
    const encoder = RitoBackgroundEncoder();
    final request = encoder.encodeRequest(
      const RitoBackgroundRequest(
        sessionId: 91,
        expectedVisibleArtifactId: 7001,
        maxTopLevelNodesPerQuantum: 64,
      ),
    );
    expect(request, orderedEquals(backgroundRequestFixture()));
    expect(request.length, RitoBackgroundEncoder.requestWireBytes);

    final handoff = encoder.encodeHandoff(
      const RitoBackgroundHandoff(
        sessionId: 91,
        expectedVisibleArtifactId: 7001,
        candidateArtifactId: 7002,
      ),
    );
    expect(handoff, orderedEquals(backgroundHandoffFixture()));
    expect(handoff.length, RitoBackgroundEncoder.handoffWireBytes);
  });

  test('background decoder accepts every state and valid nested RITOART1', () {
    const decoder = RitoBackgroundDecoder();
    for (var tag = 0; tag < RitoBackgroundState.values.length; tag += 1) {
      final advance = decoder.decodeAdvance(
        backgroundAdvanceFixture(stateTag: tag),
      );
      expect(advance.state, RitoBackgroundState.values[tag]);
      expect(advance.intentRequestId, 12);
      expect(advance.replacesArtifactId, 7001);
      expect(advance.artifact, isNull);
    }

    final advance = decoder.decodeAdvance(
      backgroundAdvanceFixture(artifact: artifactFixture()),
    );
    expect(advance.artifact?.artifactId, 7001);
    for (final stateTag in <int>[3, 4]) {
      expect(
        () => decoder.decodeAdvance(
          backgroundAdvanceFixture(
            stateTag: stateTag,
            artifact: artifactFixture(),
          ),
        ),
        throwsA(isA<FormatException>()),
      );
    }
    final ack = decoder.decodeHandoffAck(backgroundHandoffAckFixture());
    expect(ack.intentRequestId, 12);
    expect(ack.replacedArtifactId, 7001);
    expect(ack.visibleArtifactId, 7002);
  });

  test('background decoder rejects truncation, tags, IDs, and nested bytes', () {
    const decoder = RitoBackgroundDecoder();
    _expectEveryPrefixRejected(
      backgroundAdvanceFixture(artifact: artifactFixture()),
      (bytes) {
        decoder.decodeAdvance(bytes);
      },
    );
    _expectEveryPrefixRejected(backgroundHandoffAckFixture(), (bytes) {
      decoder.decodeHandoffAck(bytes);
    });
    expect(
      () => decoder.decodeAdvance(backgroundAdvanceFixture(stateTag: 5)),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decodeHandoffAck(
        backgroundHandoffAckFixture(intentRequestId: 0),
      ),
      throwsA(isA<FormatException>()),
    );
    final malformedArtifact = artifactFixture()..[0] = 0;
    final fullArtifact = artifactFixture();
    final truncatedArtifact = Uint8List.sublistView(
      fullArtifact,
      0,
      fullArtifact.length - 1,
    );
    expect(
      () => decoder.decodeAdvance(
        backgroundAdvanceFixture(artifact: malformedArtifact),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decodeAdvance(
        backgroundAdvanceFixture(artifact: truncatedArtifact),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => decoder.decodeAdvance(
        backgroundAdvanceFixture(intentRequestId: 0x8000000000000000),
      ),
      throwsA(isA<FormatException>()),
    );
  });

  test('foreground handoff encodes canonical None and Some fixed wire', () {
    const encoder = RitoForegroundEncoder();
    final initial = encoder.encodeHandoff(
      const RitoForegroundHandoff(sessionId: 91, candidateArtifactId: 7002),
    );
    expect(initial, orderedEquals(foregroundHandoffFixture()));
    expect(initial.length, RitoForegroundEncoder.handoffWireBytes);
    final replacement = encoder.encodeHandoff(
      const RitoForegroundHandoff(
        sessionId: 91,
        expectedVisibleArtifactId: 7001,
        candidateArtifactId: 7002,
      ),
    );
    expect(
      replacement,
      orderedEquals(
        foregroundHandoffFixture(expectedVisibleArtifactId: 7001),
      ),
    );
  });

  test('foreground ack decodes None and Some and rejects malformed options', () {
    const decoder = RitoForegroundDecoder();
    final initial = decoder.decodeHandoffAck(foregroundHandoffAckFixture());
    expect(initial.replacedArtifactId, isNull);
    final replacement = decoder.decodeHandoffAck(
      foregroundHandoffAckFixture(replacedArtifactId: 7001),
    );
    expect(replacement.replacedArtifactId, 7001);
    expect(replacement.visibleArtifactId, 7002);

    _expectEveryPrefixRejected(foregroundHandoffAckFixture(), (bytes) {
      decoder.decodeHandoffAck(bytes);
    });
    final unknownTag = foregroundHandoffAckFixture();
    unknownTag.buffer.asByteData().setUint32(28, 2, Endian.little);
    final noncanonicalNone = foregroundHandoffAckFixture();
    noncanonicalNone.buffer.asByteData().setUint64(32, 1, Endian.little);
    final zeroSome = foregroundHandoffAckFixture(replacedArtifactId: 7001);
    zeroSome.buffer.asByteData().setUint64(32, 0, Endian.little);
    for (final malformed in <Uint8List>[
      unknownTag,
      noncanonicalNone,
      zeroSome,
      foregroundHandoffAckFixture(intentRequestId: 0),
      foregroundHandoffAckFixture(visibleArtifactId: 0x8000000000000000),
    ]) {
      expect(
        () => decoder.decodeHandoffAck(malformed),
        throwsA(isA<FormatException>()),
      );
    }
  });

  test('fixed encoders reject invalid identities and uint32 work', () {
    const background = RitoBackgroundEncoder();
    const foreground = RitoForegroundEncoder();
    expect(
      () => background.encodeRequest(
        const RitoBackgroundRequest(
          sessionId: 0,
          expectedVisibleArtifactId: 1,
          maxTopLevelNodesPerQuantum: 1,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => background.encodeRequest(
        const RitoBackgroundRequest(
          sessionId: 1,
          expectedVisibleArtifactId: 2,
          maxTopLevelNodesPerQuantum: 0x100000000,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => foreground.encodeHandoff(
        const RitoForegroundHandoff(
          sessionId: 1,
          expectedVisibleArtifactId: 0,
          candidateArtifactId: 2,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => background.encodeHandoff(
        const RitoBackgroundHandoff(
          sessionId: 1,
          expectedVisibleArtifactId: 2,
          candidateArtifactId: 0x8000000000000000,
        ),
      ),
      throwsA(isA<FormatException>()),
    );
  });
}

void _expectEveryPrefixRejected(
  Uint8List bytes,
  void Function(Uint8List bytes) decode,
) {
  for (var end = 0; end < bytes.length; end += 1) {
    expect(
      () => decode(Uint8List.sublistView(bytes, 0, end)),
      throwsA(isA<FormatException>()),
      reason: 'prefix $end must fail',
    );
  }
}
