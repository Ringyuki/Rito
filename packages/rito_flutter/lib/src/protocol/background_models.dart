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

enum RitoBackgroundState {
  started,
  advanced,
  reused,
  candidatePending,
  complete,
  indexing,
}

final class RitoBackgroundAdvance {
  const RitoBackgroundAdvance({
    required this.state,
    required this.intentRequestId,
    required this.replacesArtifactId,
    this.movesVisibleContent = false,
    this.artifact,
  });

  final RitoBackgroundState state;
  final int intentRequestId;
  final int replacesArtifactId;

  /// Whether adopting [artifact] would put different content on screen
  /// than [replacesArtifactId] is showing.
  ///
  /// False is the ordinary handoff: the same page, renumbered onto the
  /// whole-book layout — safe to adopt without the reader noticing.
  /// True means pagination resolved the reading position onto a
  /// different page, so adoption moves the reader; a host that must not
  /// move the reader unprompted should release the candidate instead of
  /// adopting it. Always false when there is no candidate.
  ///
  /// Comparing locators yourself is not a substitute: both artifacts'
  /// locators describe the pages they draw, so they agree exactly when
  /// this is false — this field is the same answer without the host
  /// having to know that.
  final bool movesVisibleContent;
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
