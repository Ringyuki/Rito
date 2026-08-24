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
  /// In practice this is now always false, and it is kept as an
  /// assertion rather than a situation to handle: a candidate is only
  /// minted once its page is sealed (content no longer flows into it),
  /// and the completion handoff republishes the page the reader is on
  /// instead of re-resolving where they entered the book. A host that
  /// sees true should report it — the engine regressed.
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
