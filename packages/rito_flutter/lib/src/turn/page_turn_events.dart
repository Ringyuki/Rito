import '../protocol/request_models.dart';

/// How a page turn ended: it landed on its neighbour, went back where it
/// started, or was cut off by a jump or a relayout. A turn or a finger
/// that arrives meanwhile ends the one on screen, landed or gone back as it
/// was going, and takes its picture on.
enum RitoPageTurnOutcome { committed, cancelled, interrupted }

/// A page turn starting or ending. Every [RitoPageTurnStarted] is answered
/// by exactly one [RitoPageTurnEnded].
sealed class RitoPageTurnEvent {
  const RitoPageTurnEvent(this.direction);

  final RitoAdjacentDirection direction;
}

final class RitoPageTurnStarted extends RitoPageTurnEvent {
  const RitoPageTurnStarted(super.direction);
}

final class RitoPageTurnEnded extends RitoPageTurnEvent {
  const RitoPageTurnEnded(super.direction, this.outcome);

  final RitoPageTurnOutcome outcome;
}
