import 'dart:typed_data';

import 'background_models.dart';
import 'wire_message.dart';

final class RitoBackgroundEncoder {
  const RitoBackgroundEncoder();

  static const int requestWireBytes = 40;
  static const int handoffWireBytes = 44;

  Uint8List encodeRequest(RitoBackgroundRequest request) {
    final writer = RitoFixedMessageWriter('RITOBGQ1');
    writer.externalId(request.sessionId, 'session id');
    writer.externalId(
      request.expectedVisibleArtifactId,
      'expected visible artifact id',
    );
    writer.uint32(
      request.maxTopLevelNodesPerQuantum,
      'max top-level nodes per quantum',
    );
    return writer.finish(
      magic: 'RITOBGQ1',
      expectedBytes: requestWireBytes,
    );
  }

  Uint8List encodeHandoff(RitoBackgroundHandoff handoff) {
    final writer = RitoFixedMessageWriter('RITOHOF1');
    writer.externalId(handoff.sessionId, 'session id');
    writer.externalId(
      handoff.expectedVisibleArtifactId,
      'expected visible artifact id',
    );
    writer.externalId(handoff.candidateArtifactId, 'candidate artifact id');
    return writer.finish(
      magic: 'RITOHOF1',
      expectedBytes: handoffWireBytes,
    );
  }
}
