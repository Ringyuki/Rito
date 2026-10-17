import '../font/artifact_font_cache.dart';
import '../protocol/artifact_models.dart';
import '../protocol/background_models.dart';
import '../protocol/request_models.dart';
import '../reader_session.dart';

/// One background pagination quantum as the reader controller sees it:
/// whether pagination finished, and the page that replaced the visible one
/// (the same page renumbered onto the whole-book layout), if any.
typedef RitoPaginationStep = ({bool complete, RitoPreparedArtifact? adopted});

/// The session operations a [RitoReaderController] drives. Every call is
/// made one at a time, never concurrently.
abstract interface class RitoPageSource {
  RitoPreparedArtifact get firstPage;

  Future<RitoPreparedArtifact?> peek(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  );

  Future<RitoPreparedArtifact> turn(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  );

  Future<RitoPreparedArtifact> seek(
    RitoLayoutRequest layout,
    RitoLocator locator,
  );

  /// Runs one pagination quantum and adopts a candidate that replaces
  /// [visible] without moving the reader; any other candidate is released.
  Future<RitoPaginationStep> paginate(
    RitoPreparedArtifact visible,
    int quantum,
  );

  Future<void> release(RitoPreparedArtifact page);
}

/// [RitoPageSource] over a [RitoReaderSession].
final class RitoSessionPageSource implements RitoPageSource {
  RitoSessionPageSource(this.session);

  final RitoReaderSession session;

  @override
  RitoPreparedArtifact get firstPage => session.firstArtifact;

  @override
  Future<RitoPreparedArtifact?> peek(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  ) => session.peek(
    from: from,
    requestId: session.nextRequestId,
    direction: direction,
  );

  @override
  Future<RitoPreparedArtifact> turn(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  ) => session.turn(
    from: from,
    requestId: session.nextRequestId,
    direction: direction,
  );

  @override
  Future<RitoPreparedArtifact> seek(
    RitoLayoutRequest layout,
    RitoLocator locator,
  ) => session.requestArtifact(
    RitoArtifactRequest(
      sessionId: session.sessionId,
      requestId: session.nextRequestId,
      layout: layout,
      locator: locator,
    ),
  );

  @override
  Future<RitoPaginationStep> paginate(
    RitoPreparedArtifact visible,
    int quantum,
  ) async {
    final step = await session.advanceBackground(maxPagesPerQuantum: quantum);
    final complete = step.advance.state == RitoBackgroundState.complete;
    final candidate = step.artifact;
    if (candidate == null) return (complete: complete, adopted: null);
    // A candidate that would move the reader is never adopted unprompted.
    if (step.movesVisibleContent ||
        step.advance.replacesArtifactId != visible.artifactId) {
      await session.releaseArtifact(candidate);
      return (complete: complete, adopted: null);
    }
    await session.adoptBackground(step);
    return (complete: complete, adopted: candidate);
  }

  @override
  Future<void> release(RitoPreparedArtifact page) =>
      session.releaseArtifact(page);
}
