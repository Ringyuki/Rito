import 'dart:async';
import 'dart:ui' show Offset;

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import '../font/artifact_font_cache.dart';
import '../protocol/artifact_models.dart';
import '../protocol/request_models.dart';
import '../reader/reader_controller.dart';
import 'effects.dart';
import 'motion.dart';
import 'page_textures.dart';
import 'page_turn_events.dart';

/// Drives page turns over a [RitoReaderController]: landing the turn on
/// the reader, the page textures an effect paints, and one start and one
/// end per turn. How a turn moves is its [physics] and how it looks its
/// [effect]; both are the application's to replace.
///
/// Feed it a drag ([dragStart] / [dragUpdate] / [dragEnd]) or ask for a
/// [turn]; listen for every frame, or read [events] for one start and
/// exactly one end per turn. A turn commits on the reader as soon as it is
/// decided, so the page is ready when the animation arrives; the reader is
/// paused from paginating while a turn is on screen. [RitoPageTurnView]
/// paints it.
///
/// A turn or a finger that arrives while a turn is on screen cuts into it:
/// that turn ends as soon as the reader has landed it, wherever its picture
/// is, and the picture is not stopped. The turn that cut in begins where
/// the page is and as fast as it moves.
final class RitoPageTurnController extends ChangeNotifier {
  RitoPageTurnController({
    required this.reader,
    required TickerProvider vsync,
    RitoPageTurnPhysics physics = const RitoPageTurnPhysics(),
    RitoPageTurnEffect effect = RitoPageTurnEffects.slide,
    RitoPagePainter paintPage = ritoPaintArtifactPage,
    this.respectReducedMotion = true,
    this.prewarm = true,
  }) : _motion = RitoTurnMotion(physics),
       _effect = effect,
       _revision = reader.revision {
    textures = RitoPageTextures(
      painter: paintPage,
      onChanged: _texturesChanged,
    );
    _ticker = vsync.createTicker(_tick);
    reader.addListener(_readerChanged);
    _prewarm();
  }

  final RitoReaderController reader;

  /// While the system asks for reduced motion ([reduceMotion]), turns
  /// cross-fade whatever the [effect].
  final bool respectReducedMotion;

  /// Lays out both neighbours while no turn is on screen and, between
  /// frames once nothing moves, rasterizes them and the page on screen, so
  /// a turn starts with no page left to draw. Three page images stay in
  /// memory at rest.
  final bool prewarm;

  /// The page images effects paint from.
  late final RitoPageTextures textures;

  final RitoTurnMotion _motion;
  late final Ticker _ticker;
  final StreamController<RitoPageTurnEvent> _events =
      StreamController<RitoPageTurnEvent>.broadcast();
  RitoPageTurnEffect _effect;
  bool _reduceMotion = false;
  int _revision;
  Duration _lastTick = Duration.zero;

  RitoAdjacentDirection? _open;
  bool _committing = false;
  bool _landing = false;
  RitoPreparedArtifact? _landed;
  RitoAdjacentDirection? _pendingTurn;
  VoidCallback? _releasePagination;

  bool _dragActive = false;
  Offset _dragOrigin = Offset.zero;
  Offset _dragPosition = Offset.zero;

  /// A finger came down on a turn and takes hold once its outcome is settled.
  bool _dragWaiting = false;
  RitoPageTurnTouch? _touch;

  /// How far the finger had carried the turn at its farthest the way the
  /// turn goes, and where it was then; null before it has carried it.
  ({double travel, Offset at})? _farthest;

  Timer? _warmTimer;

  /// One start and exactly one end for every turn.
  Stream<RitoPageTurnEvent> get events => _events.stream;

  /// The direction of the turn on screen; null when none is.
  RitoAdjacentDirection? get direction => _open;

  bool get isTurning => _open != null;

  /// Whether anything is moving: a turn, or what is left of one that
  /// another cut into, still on its way to rest though it has ended.
  /// [RitoPageTurnView] paints while it is.
  bool get isMoving =>
      _open != null || _motion.phase != RitoTurnMotionPhase.idle;

  /// The frame effects paint now; with nothing moving, the page at rest.
  /// While a turn is still on the far side of where it began, the frame is
  /// the picture of the turn it cut into: [RitoPageTurnFrame.incoming]
  /// names the page that turn was leaving.
  RitoPageTurnFrame get frame {
    final open = _open;
    if (open == null && _motion.phase == RitoTurnMotionPhase.finishing) {
      return RitoPageTurnFrame(
        offset: _motion.offset,
        width: _motion.width,
        incoming: _motion.showing,
        phase: RitoPageTurnPhase.returning,
        velocity: _motion.velocity,
      );
    }
    if (open == null) {
      return RitoPageTurnFrame(
        offset: 0,
        width: _motion.width,
        incoming: null,
        phase: RitoPageTurnPhase.returning,
      );
    }
    return RitoPageTurnFrame(
      offset: _motion.offset,
      width: _motion.width,
      incoming: _motion.showing,
      phase: _motion.phase == RitoTurnMotionPhase.dragging
          ? RitoPageTurnPhase.held
          : _committing && !_motion.onFarSide
          ? RitoPageTurnPhase.landing
          : RitoPageTurnPhase.returning,
      velocity: _motion.velocity,
      touch: _touch,
    );
  }

  RitoPageTurnPhysics get physics => _motion.physics;
  set physics(RitoPageTurnPhysics value) => _motion.physics = value;

  /// The configured effect; see [effectiveEffect].
  RitoPageTurnEffect get effect => _effect;
  set effect(RitoPageTurnEffect value) {
    if (identical(value, _effect)) return;
    _effect = value;
    notifyListeners();
  }

  /// Whether the system asks for reduced motion ([RitoPageTurnView] keeps
  /// it in step with the platform).
  bool get reduceMotion => _reduceMotion;
  set reduceMotion(bool value) {
    if (value == _reduceMotion) return;
    _reduceMotion = value;
    notifyListeners();
  }

  /// What turns look like now: the [effect], or a cross-fade under
  /// [reduceMotion].
  RitoPageTurnEffect get effectiveEffect =>
      _reduceMotion && respectReducedMotion
      ? RitoPageTurnEffects.fade
      : _effect;

  /// The page width a turn travels (logical px).
  double get width => _motion.width;
  set width(double value) => _motion.width = value;

  /// A finger took hold of the page at [position], in the coordinates the
  /// turn is painted in ([RitoPageTurnView]'s own). On a turn already on
  /// screen it cuts into it, and takes the page where it is once that turn
  /// is over.
  void dragStart(Offset position) {
    _dragOrigin = position;
    _dragPosition = position;
    if (_open == null) {
      _dragActive = true;
    } else {
      _dragWaiting = true;
      _settleTurn();
    }
  }

  /// The finger is at [position].
  void dragUpdate(Offset position) {
    _dragPosition = position;
    if (!_dragActive) return;
    final travel = physics.travel(_dragOrigin, position);
    if (_open == null) {
      if (travel == 0) return;
      final direction = travel < 0
          ? RitoAdjacentDirection.next
          : RitoAdjacentDirection.previous;
      _begin(direction);
      _motion.startDrag(
        forward: direction == RitoAdjacentDirection.next,
        hasIncoming: reader.canTurn(direction),
      );
    }
    final far = _farthest;
    final farther =
        far == null ||
        (_motion.forward ? travel < far.travel : travel > far.travel);
    final farthest = farther ? (travel: travel, at: position) : far;
    _farthest = farthest;
    _touch = RitoPageTurnTouch(
      origin: _dragOrigin,
      position: position,
      farthest: farthest.at,
    );
    _motion.drag(travel);
    notifyListeners();
  }

  /// The finger lifted, moving at [velocity] logical px/s.
  void dragEnd(Offset velocity) {
    _dragWaiting = false;
    if (!_dragActive) return;
    _dragActive = false;
    if (_motion.release(_speedAlongTurn(velocity), touch: _touch)) _commit();
    _run();
  }

  /// How fast the turn moves under a finger moving at [velocity]: how far
  /// the physics' travel changes over the next 1/1024 s of it.
  double _speedAlongTurn(Offset velocity) {
    const step = 1 / 1024;
    return (physics.travel(_dragOrigin, _dragPosition + velocity * step) -
            physics.travel(_dragOrigin, _dragPosition)) /
        step;
  }

  /// The drag was taken away (another gesture won); the page goes back.
  void dragCancel() {
    _dragWaiting = false;
    if (!_dragActive) return;
    _dragActive = false;
    _motion.cancel();
    _run();
  }

  /// Turns to the neighbour in [direction] (a tap, a key). A turn asked for
  /// while another one is on screen cuts into it and begins where its page
  /// is; false at the end of the book.
  bool turn(RitoAdjacentDirection direction) {
    if (_dragActive) return false;
    if (_open == null) {
      if (!reader.canTurn(direction)) return false;
      _begin(direction);
      _motion.turn(forward: direction == RitoAdjacentDirection.next);
      _commit();
      _run();
      return true;
    }
    if (direction == _open && !_committing && reader.canTurn(direction)) {
      _motion.turn(forward: direction == RitoAdjacentDirection.next);
      _commit();
      _run();
      return true;
    }
    _pendingTurn = direction;
    _settleTurn();
    return true;
  }

  /// Shows the page at [locator]. With [animateAs], the jump plays as a
  /// turn in that direction from the page on screen.
  Future<RitoPreparedArtifact?> jumpTo(
    RitoLocator locator, {
    RitoAdjacentDirection? animateAs,
  }) async {
    if (animateAs == null || _open != null) return reader.jumpTo(locator);
    // Rasterize the page on screen now: the jump releases it.
    textures.assign(RitoPageSlot.current, reader.page);
    textures.freeze(RitoPageSlot.current);
    _landing = true;
    final RitoPreparedArtifact? page;
    try {
      page = await reader.jumpTo(locator);
    } finally {
      _landing = false;
    }
    _revision = reader.revision;
    if (page == null || _open != null) return page;
    textures.clear(except: {RitoPageSlot.current});
    textures.assign(_slotOf(animateAs), page, jump: true);
    _begin(animateAs, fromShown: true);
    _motion.turn(forward: animateAs == RitoAdjacentDirection.next);
    _committing = true;
    _landed = page;
    _run();
    return page;
  }

  /// Redraws every page texture (a theme or highlight change).
  void invalidatePages() => textures.invalidate();

  /// Opens a turn. [fromShown] keeps the current texture as it is (a jump
  /// that already replaced the reader's page).
  void _begin(RitoAdjacentDirection direction, {bool fromShown = false}) {
    _end(RitoPageTurnOutcome.interrupted);
    _open = direction;
    _committing = false;
    _landed = null;
    _touch = null;
    _farthest = null;
    _releasePagination ??= reader.holdPagination();
    if (!fromShown) {
      textures.assign(RitoPageSlot.current, reader.page);
      // Rasterize the page on screen before the turn can release it.
      textures.image(RitoPageSlot.current);
    }
    if (reader.canTurn(direction) &&
        textures.page(_slotOf(direction)) == null) {
      _fetchNeighbour(direction, reveal: true);
    }
    _events.add(RitoPageTurnStarted(direction));
  }

  /// Lands the decided turn on the reader while the animation plays.
  void _commit() {
    final direction = _open;
    if (direction == null || _committing) return;
    _committing = true;
    _landing = true;
    // Landing releases every page but the incoming one.
    for (final slot in RitoPageSlot.values) {
      if (slot != _slotOf(direction)) textures.freeze(slot);
    }
    reader
        .turn(direction)
        .then<void>(
          (page) => _landed = page,
          onError: (Object error, StackTrace stack) {
            _landed = null;
            _report(error, stack);
          },
        )
        .whenComplete(() {
          _landing = false;
          _revision = reader.revision;
          _settleTurn();
        });
  }

  /// Ends the turn on screen once it can be ended: when it has come to
  /// rest, or at once when a turn or a finger has cut into it. A turn that
  /// was decided waits for the reader to land it either way; cut into, it
  /// then ends wherever its picture is and the picture carries on.
  void _settleTurn() {
    final open = _open;
    if (open == null) return;
    final atRest =
        !_motion.moving && _motion.phase != RitoTurnMotionPhase.dragging;
    final cut = _pendingTurn != null || _dragWaiting;
    if (!atRest && !cut) return;
    if (_committing && _landing) return;
    if (_committing && _landed == null) {
      // The neighbour could not be shown: the page goes back.
      _committing = false;
      _motion.cancel();
      _run();
      if (!cut) return;
    }
    // Nothing is left of a turn at rest, or of one that lands at once.
    final carries =
        _motion.phase != RitoTurnMotionPhase.idle && !effectiveEffect.instant;
    final landed = _landed;
    if (_committing && landed != null) {
      final incoming = _slotOf(open);
      if (carries) {
        // The page it left is still in the frame: its image stays beside
        // the page it landed on.
        textures.move(RitoPageSlot.current, _slotOf(_opposite(open)));
      } else {
        textures.clear(except: {incoming});
      }
      textures.move(incoming, RitoPageSlot.current);
      textures.assign(RitoPageSlot.current, landed);
      if (carries) {
        _motion.carryOn(committed: true);
      } else {
        _motion.reset();
      }
      _end(RitoPageTurnOutcome.committed);
    } else {
      if (carries) {
        _motion.carryOn(committed: false);
      } else {
        _motion.reset();
      }
      _end(RitoPageTurnOutcome.cancelled);
    }
    _afterTurn();
  }

  void _afterTurn() {
    final pending = _pendingTurn;
    _pendingTurn = null;
    if (_dragWaiting) {
      // The finger that waited takes hold where it is now.
      _dragWaiting = false;
      _dragActive = true;
      _dragOrigin = _dragPosition;
    } else if (pending != null && turn(pending)) {
      return;
    }
    if (_motion.moving) _run();
    _prewarm();
  }

  void _end(RitoPageTurnOutcome outcome) {
    final open = _open;
    if (open == null) return;
    _open = null;
    _committing = false;
    _touch = null;
    _farthest = null;
    _releasePagination?.call();
    _releasePagination = null;
    notifyListeners();
    _events.add(RitoPageTurnEnded(open, outcome));
  }

  void _run() {
    notifyListeners();
    if (!_ticker.isActive) {
      _lastTick = Duration.zero;
      unawaited(_ticker.start());
    }
  }

  void _tick(Duration elapsed) {
    final seconds = _lastTick == Duration.zero
        ? 1 / 60
        : ((elapsed - _lastTick).inMicroseconds / 1e6).clamp(0.0, 0.032);
    _lastTick = elapsed;
    final finishing = _motion.phase == RitoTurnMotionPhase.finishing;
    final settled = _motion.step(seconds, instant: effectiveEffect.instant);
    final fading = textures.advanceReveal(seconds);
    notifyListeners();
    if (settled) _settleTurn();
    // What was left of a turn has come to rest with nothing having taken
    // it up: the page it left is no longer in the frame.
    if (finishing && _open == null && !_motion.moving) {
      textures.clear(except: {RitoPageSlot.current});
      _prewarm();
    }
    if (!_motion.moving && !fading) _ticker.stop();
  }

  void _readerChanged() {
    if (reader.revision == _revision || _landing) return;
    _revision = reader.revision;
    final renumbered = reader.lastChange == RitoPageChange.pagination;
    // The neighbours peeked from the old page are about to be released; a
    // page renumbered stays the same page in its slot.
    textures.clear(except: {if (renumbered) RitoPageSlot.current});
    if (renumbered) {
      // The same page renumbered: a turn on screen carries on with fresh
      // pages.
      final open = _open;
      textures.assign(RitoPageSlot.current, reader.page);
      if (open != null && reader.canTurn(open)) {
        _fetchNeighbour(open, reveal: true);
      }
      if (open == null) _prewarm();
      return;
    }
    // Something else moved the reader (a jump, a relayout): nothing that
    // was on its way carries on, and a finger that waited takes hold.
    _motion.reset();
    _pendingTurn = null;
    if (_dragWaiting) {
      _dragWaiting = false;
      _dragActive = true;
      _dragOrigin = _dragPosition;
    }
    _end(RitoPageTurnOutcome.interrupted);
    _prewarm();
  }

  void _prewarm() {
    if (!prewarm || _open != null) return;
    textures.assign(RitoPageSlot.current, reader.page);
    for (final direction in const [
      RitoAdjacentDirection.next,
      RitoAdjacentDirection.previous,
    ]) {
      if (reader.canTurn(direction) &&
          textures.page(_slotOf(direction)) == null) {
        _fetchNeighbour(direction, reveal: false);
      }
    }
    _scheduleWarm();
  }

  void _texturesChanged() {
    notifyListeners();
    _scheduleWarm();
  }

  /// Rasterizes the pages a turn starts from in a task of the event loop,
  /// between frames. Not an idle-priority task of the scheduler: while any
  /// animation runs, the scheduler retries such a task with one zero-delay
  /// timer after another, which keeps the isolate busy for as long as the
  /// animation runs.
  void _scheduleWarm() {
    if (!prewarm || _warmTimer != null || _disposed) return;
    _warmTimer = Timer(Duration.zero, _warm);
  }

  /// Rasterizes one page that needs it, the one on screen first, and comes
  /// back for the next: one page per task keeps each short. A turn that
  /// began meanwhile draws its own pages, and the next rest warms again.
  void _warm() {
    _warmTimer = null;
    if (_disposed || isMoving) return;
    for (final slot in const [
      RitoPageSlot.current,
      RitoPageSlot.next,
      RitoPageSlot.previous,
    ]) {
      if (!textures.needsDrawing(slot)) continue;
      textures.image(slot);
      _scheduleWarm();
      return;
    }
  }

  void _fetchNeighbour(
    RitoAdjacentDirection direction, {
    required bool reveal,
  }) {
    final revision = reader.revision;
    reader.neighbour(direction).then<void>((page) {
      if (page == null || revision != reader.revision || _disposed) return;
      final shown = reveal && _open == direction;
      textures.assign(_slotOf(direction), page, reveal: shown);
      if (shown) _run();
    }, onError: _report);
  }

  static RitoPageSlot _slotOf(RitoAdjacentDirection direction) =>
      direction == RitoAdjacentDirection.next
      ? RitoPageSlot.next
      : RitoPageSlot.previous;

  static RitoAdjacentDirection _opposite(RitoAdjacentDirection direction) =>
      direction == RitoAdjacentDirection.next
      ? RitoAdjacentDirection.previous
      : RitoAdjacentDirection.next;

  void _report(Object error, StackTrace stack) {
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stack,
        library: 'rito_flutter',
        context: ErrorDescription('turning a page'),
      ),
    );
  }

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    _warmTimer?.cancel();
    reader.removeListener(_readerChanged);
    _motion.reset();
    _end(RitoPageTurnOutcome.interrupted);
    _ticker.dispose();
    textures.dispose();
    unawaited(_events.close());
    super.dispose();
  }
}
