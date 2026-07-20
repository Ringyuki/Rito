import 'dart:typed_data';

import 'foreground_models.dart';
import 'wire_message.dart';

final class RitoForegroundEncoder {
  const RitoForegroundEncoder();

  static const int handoffWireBytes = 48;

  Uint8List encodeHandoff(RitoForegroundHandoff handoff) {
    final writer = RitoFixedMessageWriter('RITOFGH1');
    writer.externalId(handoff.sessionId, 'session id');
    writer.fixedOptionalExternalId(
      handoff.expectedVisibleArtifactId,
      'expected visible artifact id',
    );
    writer.externalId(handoff.candidateArtifactId, 'candidate artifact id');
    return writer.finish(
      magic: 'RITOFGH1',
      expectedBytes: handoffWireBytes,
    );
  }
}
