import 'dart:typed_data';

import 'artifact_decoder.dart';
import 'background_models.dart';
import 'binary_reader.dart';
import 'wire_message.dart';

final class RitoBackgroundDecoder {
  const RitoBackgroundDecoder({
    this.artifactDecoder = const RitoArtifactDecoder(),
  });

  static const int advancePrefixWireBytes = 48;
  static const int handoffAckWireBytes = 44;

  final RitoArtifactDecoder artifactDecoder;

  RitoBackgroundAdvance decodeAdvance(Uint8List bytes) {
    final reader = openRitoWireMessage(
      bytes,
      magic: 'RITOBGA1',
      label: 'background advance',
    );
    final state = _state(reader);
    final intentRequestId = reader.externalId('intent request id');
    final replacesArtifactId = reader.externalId('replaces artifact id');
    final artifactBytes = reader.blobView('background artifact');
    // Complete may carry exactly one artifact: the completion handoff
    // that delivers the book page count to a reader who never turned a
    // page. Indexing and candidatePending carry nothing by definition.
    if ((state == RitoBackgroundState.candidatePending ||
            state == RitoBackgroundState.indexing) &&
        artifactBytes.isNotEmpty) {
      reader.fail('$state background advance must not carry an artifact');
    }
    final artifact = artifactBytes.isEmpty
        ? null
        : artifactDecoder.decode(artifactBytes);
    reader.finish('background advance wire message');
    return RitoBackgroundAdvance(
      state: state,
      intentRequestId: intentRequestId,
      replacesArtifactId: replacesArtifactId,
      artifact: artifact,
    );
  }

  RitoBackgroundHandoffAck decodeHandoffAck(Uint8List bytes) {
    final reader = openRitoWireMessage(
      bytes,
      magic: 'RITOHOA1',
      label: 'background handoff ack',
      exactBytes: handoffAckWireBytes,
    );
    final ack = RitoBackgroundHandoffAck(
      intentRequestId: reader.externalId('intent request id'),
      replacedArtifactId: reader.externalId('replaced artifact id'),
      visibleArtifactId: reader.externalId('visible artifact id'),
    );
    reader.finish('background handoff ack wire message');
    return ack;
  }

  RitoBackgroundState _state(RitoBinaryReader reader) {
    final tag = reader.uint32('background state');
    return switch (tag) {
      0 => RitoBackgroundState.started,
      1 => RitoBackgroundState.advanced,
      2 => RitoBackgroundState.reused,
      3 => RitoBackgroundState.candidatePending,
      4 => RitoBackgroundState.complete,
      5 => RitoBackgroundState.indexing,
      _ => reader.fail('unknown background state: $tag'),
    };
  }
}
