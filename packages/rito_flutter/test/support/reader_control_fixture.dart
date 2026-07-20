import 'dart:typed_data';

import 'wire_writer.dart';

Uint8List backgroundRequestFixture({
  int sessionId = 91,
  int expectedVisibleArtifactId = 7001,
  int maxTopLevelNodesPerQuantum = 64,
}) {
  final writer = TestWireWriter.message('RITOBGQ1');
  writer
    ..uint64(sessionId)
    ..uint64(expectedVisibleArtifactId)
    ..uint32(maxTopLevelNodesPerQuantum);
  return writer.finishMessage();
}

Uint8List backgroundAdvanceFixture({
  int stateTag = 0,
  int intentRequestId = 12,
  int replacesArtifactId = 7001,
  List<int> artifact = const <int>[],
}) {
  final writer = TestWireWriter.message('RITOBGA1');
  writer
    ..uint32(stateTag)
    ..uint64(intentRequestId)
    ..uint64(replacesArtifactId)
    ..blob(artifact);
  return writer.finishMessage();
}

Uint8List backgroundHandoffFixture({
  int sessionId = 91,
  int expectedVisibleArtifactId = 7001,
  int candidateArtifactId = 7002,
}) {
  final writer = TestWireWriter.message('RITOHOF1');
  writer
    ..uint64(sessionId)
    ..uint64(expectedVisibleArtifactId)
    ..uint64(candidateArtifactId);
  return writer.finishMessage();
}

Uint8List backgroundHandoffAckFixture({
  int intentRequestId = 12,
  int replacedArtifactId = 7001,
  int visibleArtifactId = 7002,
}) {
  final writer = TestWireWriter.message('RITOHOA1');
  writer
    ..uint64(intentRequestId)
    ..uint64(replacedArtifactId)
    ..uint64(visibleArtifactId);
  return writer.finishMessage();
}

Uint8List foregroundHandoffFixture({
  int sessionId = 91,
  int? expectedVisibleArtifactId,
  int candidateArtifactId = 7002,
}) {
  final writer = TestWireWriter.message('RITOFGH1');
  writer
    ..uint64(sessionId)
    ..fixedExternalIdOption(expectedVisibleArtifactId)
    ..uint64(candidateArtifactId);
  return writer.finishMessage();
}

Uint8List foregroundHandoffAckFixture({
  int intentRequestId = 12,
  int? replacedArtifactId,
  int visibleArtifactId = 7002,
}) {
  final writer = TestWireWriter.message('RITOFGA1');
  writer
    ..uint64(intentRequestId)
    ..fixedExternalIdOption(replacedArtifactId)
    ..uint64(visibleArtifactId);
  return writer.finishMessage();
}
