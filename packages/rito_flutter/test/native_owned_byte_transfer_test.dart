import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/src/native/owned_byte_transfer.dart';
import 'package:rito_flutter/src/protocol/artifact_decoder.dart';
import 'package:rito_flutter/src/protocol/resource_decoder.dart';

import 'support/artifact_fixture.dart';

void main() {
  test(
    'a whole EPUB open payload crosses with transferable isolate transport',
    () async {
      final publication = File(
        '../rito/tests/fixtures/books/book-10.epub',
      ).readAsBytesSync();
      final input = RitoOwnedByteTransfer.take(publication);

      final output = await _echoOnWorker(input);
      expect(
        () => RitoOwnedByteTransfer.materialize(input),
        throwsA(anything),
        reason: 'the sender must not retain a consumable publication buffer',
      );
      final received = RitoOwnedByteTransfer.materialize(output);

      expect(received, publication);
      expect(
        () => RitoOwnedByteTransfer.materialize(output),
        throwsA(anything),
        reason: 'the receiver may materialize the EPUB exactly once',
      );
    },
  );

  test('artifact and resource wire responses decode after transfer', () async {
    final artifactOutput = await _echoOnWorker(
      RitoOwnedByteTransfer.take(artifactFixture()),
    );
    final artifact = const RitoArtifactDecoder().decode(
      RitoOwnedByteTransfer.materialize(artifactOutput),
    );
    expect(artifact.sessionId, 91);
    expect(artifact.requestId, 12);
    expect(artifact.artifactId, 7001);

    final resourceOutput = await _echoOnWorker(
      RitoOwnedByteTransfer.take(
        resourceFixture(bytes: List<int>.filled(256 * 1024, 0x5a)),
      ),
    );
    final resource = const RitoResourceDecoder().decode(
      RitoOwnedByteTransfer.materialize(resourceOutput),
    );
    expect(resource.artifactId, artifact.artifactId);
    expect(resource.bytes.length, 256 * 1024);
    expect(resource.bytes.first, 0x5a);
  });

  test('malformed and late transfer consumption fail closed', () async {
    final malformed = Uint8List.fromList(<int>[0x52, 0x49, 0x54, 0x4f]);
    final output = await _echoOnWorker(RitoOwnedByteTransfer.take(malformed));
    final received = RitoOwnedByteTransfer.materialize(output);

    expect(
      () => const RitoArtifactDecoder().decode(received),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => RitoOwnedByteTransfer.materialize(output),
      throwsA(anything),
      reason: 'a late response consumer cannot rematerialize owned bytes',
    );
  });
}

Future<TransferableTypedData> _echoOnWorker(
  TransferableTypedData transfer,
) async {
  final reply = ReceivePort();
  await Isolate.spawn<(TransferableTypedData, SendPort)>(_echoWorker, (
    transfer,
    reply.sendPort,
  ));
  try {
    return await reply.first as TransferableTypedData;
  } finally {
    reply.close();
  }
}

void _echoWorker((TransferableTypedData, SendPort) message) {
  final bytes = RitoOwnedByteTransfer.materialize(message.$1);
  message.$2.send(RitoOwnedByteTransfer.take(bytes));
}
