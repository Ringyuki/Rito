import 'dart:typed_data';

import 'foreground_models.dart';
import 'wire_message.dart';

final class RitoForegroundDecoder {
  const RitoForegroundDecoder();

  static const int handoffAckWireBytes = 48;

  RitoForegroundHandoffAck decodeHandoffAck(Uint8List bytes) {
    final reader = openRitoWireMessage(
      bytes,
      magic: 'RITOFGA1',
      label: 'foreground handoff ack',
      exactBytes: handoffAckWireBytes,
    );
    final ack = RitoForegroundHandoffAck(
      intentRequestId: reader.externalId('intent request id'),
      replacedArtifactId: reader.fixedOptionalExternalId(
        'replaced artifact id',
      ),
      visibleArtifactId: reader.externalId('visible artifact id'),
    );
    reader.finish('foreground handoff ack wire message');
    return ack;
  }
}
