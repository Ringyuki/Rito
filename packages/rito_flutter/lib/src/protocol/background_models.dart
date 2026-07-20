import 'artifact_models.dart';

final class RitoBackgroundRequest {
  const RitoBackgroundRequest({
    required this.sessionId,
    required this.expectedVisibleArtifactId,
    required this.maxTopLevelNodesPerQuantum,
  });

  final int sessionId;
  final int expectedVisibleArtifactId;
  final int maxTopLevelNodesPerQuantum;
}

enum RitoBackgroundState { started, advanced, reused, candidatePending, complete }

final class RitoBackgroundAdvance {
  const RitoBackgroundAdvance({
    required this.state,
    required this.intentRequestId,
    required this.replacesArtifactId,
    this.artifact,
  });

  final RitoBackgroundState state;
  final int intentRequestId;
  final int replacesArtifactId;
  final RitoArtifact? artifact;
}

final class RitoBackgroundHandoff {
  const RitoBackgroundHandoff({
    required this.sessionId,
    required this.expectedVisibleArtifactId,
    required this.candidateArtifactId,
  });

  final int sessionId;
  final int expectedVisibleArtifactId;
  final int candidateArtifactId;
}

final class RitoBackgroundHandoffAck {
  const RitoBackgroundHandoffAck({
    required this.intentRequestId,
    required this.replacedArtifactId,
    required this.visibleArtifactId,
  });

  final int intentRequestId;
  final int replacedArtifactId;
  final int visibleArtifactId;
}
