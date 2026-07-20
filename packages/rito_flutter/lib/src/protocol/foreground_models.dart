final class RitoForegroundHandoff {
  const RitoForegroundHandoff({
    required this.sessionId,
    required this.candidateArtifactId,
    this.expectedVisibleArtifactId,
  });

  final int sessionId;
  final int? expectedVisibleArtifactId;
  final int candidateArtifactId;
}

final class RitoForegroundHandoffAck {
  const RitoForegroundHandoffAck({
    required this.intentRequestId,
    required this.visibleArtifactId,
    this.replacedArtifactId,
  });

  final int intentRequestId;
  final int? replacedArtifactId;
  final int visibleArtifactId;
}
