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
    textures = RitoPageTextures(painter: paintPage, onChanged: notifyListeners);
    _ticker = vsync.createTicker(_tick);
    reader.addListener(_readerChanged);
    _prewarm();
  }

  final RitoReaderController reader;

  /// While the system asks for reduced motion ([reduceMotion]), turns
  /// cross-fade whatever the [effect].
  final bool respectReducedMotion;

  /// Lays out and rasterizes both neighbours while no turn is on screen,
  /// so a turn starts with its page ready.
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
  double _dragBase = 0;
  Offset _dragOrigin = Offset.zero;
  Offset _dragPosition = Offset.zero;
  bool _dragDeferred = false;
  RitoPageTurnTouch? _touch;

  /// One start and exactly one end for every turn.
  Stream<RitoPageTurnEvent> get events => _events.stream;

  /// The direction of the turn on screen; null when none is.
  RitoAdjacentDirection? get direction => _open;

  bool get isTurning => _open != null;

  /// The frame effects paint now; with no turn on screen, the page at rest.
  RitoPageTurnFrame get frame {
    final open = _open;
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
      incoming: _motion.hasIncoming ? _slotOf(open) : null,
      phase: _motion.phase == RitoTurnMotionPhase.dragging
          ? RitoPageTurnPhase.held
          : _committing
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
  /// turn is painted in ([RitoPageTurnView]'s own).
  void dragStart(Offset position) {
    _dragOrigin = position;
    _dragPosition = position;
    if (_open == null) {
      _dragActive = true;
      _dragBase = 0;
    } else if (_motion.committing || _landing) {
      // The page is already on its way: the drag picks up once it lands.
      _dragDeferred = true;
      _motion.finish();
      _finishIfSettled();
    } else if (_motion.phase == RitoTurnMotionPhase.settling) {
      _motion.resumeDrag();
      _dragActive = true;
      _dragBase = _motion.offset;
      _touch = RitoPageTurnTouch(origin: position, position: position);
      notifyListeners();
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
    _touch = RitoPageTurnTouch(origin: _dragOrigin, position: position);
    _motion.drag(_dragBase + travel);
    notifyListeners();
  }

  /// The finger lifted, moving at [velocity] logical px/s.
  void dragEnd(Offset velocity) {
    _dragDeferred = false;
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
    _dragDeferred = false;
    if (!_dragActive) return;
    _dragActive = false;
    _motion.cancel();
    _run();
  }

  /// Turns to the neighbour in [direction] (a tap, a key). A turn asked for
  /// while another one is landing follows it; false at the end of the book.
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
    _motion.finish();
    _finishIfSettled();
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
    textures.assign(_slotOf(animateAs), page);
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
          _finishIfSettled();
        });
  }

  void _finishIfSettled() {
    final open = _open;
    if (open == null || _motion.phase != RitoTurnMotionPhase.idle) return;
    if (_committing) {
      if (_landing) return;
      final landed = _landed;
      if (landed == null) {
        // The neighbour could not be shown: the page goes back.
        _committing = false;
        _motion.cancel();
        _run();
        return;
      }
      textures.clear(except: {_slotOf(open)});
      textures.move(_slotOf(open), RitoPageSlot.current);
      textures.assign(RitoPageSlot.current, landed);
      _motion.reset();
      _end(RitoPageTurnOutcome.committed);
    } else {
      _motion.reset();
      _end(RitoPageTurnOutcome.cancelled);
    }
    _afterTurn();
  }

  void _afterTurn() {
    final pending = _pendingTurn;
    _pendingTurn = null;
    if (_dragDeferred) {
      // The finger that waited takes hold where it is now.
      _dragDeferred = false;
      _dragActive = true;
      _dragBase = 0;
      _dragOrigin = _dragPosition;
    } else if (pending != null && turn(pending)) {
      return;
    }
    _prewarm();
  }

  void _end(RitoPageTurnOutcome outcome) {
    final open = _open;
    if (open == null) return;
    _open = null;
    _committing = false;
    _touch = null;
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
    final settled = _motion.step(seconds, instant: effectiveEffect.instant);
    final fading = textures.advanceReveal(seconds);
    notifyListeners();
    if (settled) _finishIfSettled();
    if (_motion.phase != RitoTurnMotionPhase.settling && !fading) {
      _ticker.stop();
    }
  }

  void _readerChanged() {
    if (reader.revision == _revision || _landing) return;
    _revision = reader.revision;
    // The neighbours peeked from the old page are about to be released.
    textures.clear();
    if (reader.lastChange == RitoPageChange.pagination) {
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
    // Something else moved the reader (a jump, a relayout).
    _motion.reset();
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
    reader.removeListener(_readerChanged);
    _motion.reset();
    _end(RitoPageTurnOutcome.interrupted);
    _ticker.dispose();
    textures.dispose();
    unawaited(_events.close());
    super.dispose();
  }
}
