import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show Offset;

import 'package:flutter/foundation.dart';
import 'package:flutter/physics.dart' show Simulation;
import 'package:flutter/scheduler.dart';

import '../font/artifact_font_cache.dart';
import '../native/bindings.dart';
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
/// [effect]; both are the application's to replace. When a turn begins,
/// lands and ends, and what a finger, a key or a jump does to one on
/// screen, is the engine's, the same as on the web.
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
/// the page is and as fast as it moves; a finger takes it where it is by
/// then. Every key pressed while turns land turns a page. A pull against
/// the first or last page moves it and is no turn.
final class RitoPageTurnController extends ChangeNotifier {
  RitoPageTurnController({
    required this.reader,
    required TickerProvider vsync,
    RitoPageTurnPhysics? physics,
    RitoPageTurnEffect effect = RitoPageTurnEffects.slide,
    RitoPagePainter paintPage = ritoPaintArtifactPage,
    this.respectReducedMotion = true,
    this.prewarm = true,
  }) : _physics = physics,
       _effect = effect,
       _revision = reader.revision {
    _native = RitoNativeTurnController(
      ritoTurnPhysicsNumbers(effectivePhysics),
    );
    textures = RitoPageTextures(
      painter: paintPage,
      onChanged: _texturesChanged,
    );
    _ticker = vsync.createTicker(_tick);
    reader.addListener(_readerChanged);
    _configure();
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

  late final RitoNativeTurnController _native;
  late final Ticker _ticker;
  final StreamController<RitoPageTurnEvent> _events =
      StreamController<RitoPageTurnEvent>.broadcast();
  RitoPageTurnEffect _effect;
  bool _reduceMotion = false;
  int _revision;
  double _width = 0;

  /// When the ticker last ticked; null while it is stopped.
  Duration? _lastTick;
  final _clock = Stopwatch()..start();

  /// Where the finger came down, and where and when it was last heard of.
  Offset _dragOrigin = Offset.zero;
  Offset _lastPosition = Offset.zero;
  double _dragAt = 0;

  /// The page the reader landed the turn on screen on; null when it could not.
  RitoPreparedArtifact? _landed;

  /// The reader is landing a turn (or a jump played as one): its own change
  /// of page is not news.
  bool _landing = false;

  /// A jump played as a turn is beginning: its pages are in their slots.
  bool _jumping = false;

  /// The physics' own motion carrying what is on screen, and which of the
  /// engine's motions it carries.
  Simulation? _settle;
  double _settleGeneration = 0;

  /// The effect's [RitoPageTurnEffect.repaint], listened to while a turn
  /// waits for the effect to be able to draw it.
  Listenable? _waitingOn;

  /// How long a turn waits for its effect before it begins regardless, the
  /// effect drawing it as it can: no effect holds the page still for long.
  static const effectPatience = Duration(milliseconds: 500);

  Timer? _effectTimer;
  VoidCallback? _releasePagination;
  Timer? _warmTimer;

  /// One start and exactly one end for every turn.
  Stream<RitoPageTurnEvent> get events => _events.stream;

  Float64List get _state => _native.state;

  /// The direction of the turn on screen; null when none is.
  RitoAdjacentDirection? get direction => switch (_state[0]) {
    1 => RitoAdjacentDirection.next,
    2 => RitoAdjacentDirection.previous,
    _ => null,
  };

  bool get isTurning => _state[0] != 0;

  /// Whether anything is moving: a turn, a pull against the first or last
  /// page, or what is left of a turn that another cut into, still on its
  /// way to rest though it has ended. [RitoPageTurnView] paints while it is.
  bool get isMoving => _state[1] == 1;

  /// The frame effects paint now; with nothing moving, the page at rest.
  /// While a turn is still on the far side of where it began, the frame is
  /// the picture of the turn it cut into: [RitoPageTurnFrame.incoming]
  /// names the page that turn was leaving.
  RitoPageTurnFrame get frame {
    final state = _state;
    if (state[9] == 0) {
      return RitoPageTurnFrame(
        offset: 0,
        width: _width,
        incoming: null,
        phase: RitoPageTurnPhase.returning,
      );
    }
    return RitoPageTurnFrame(
      offset: state[10],
      width: _width,
      incoming: switch (state[11]) {
        1 => RitoPageSlot.next,
        2 => RitoPageSlot.previous,
        _ => null,
      },
      phase: switch (state[12]) {
        0 => RitoPageTurnPhase.held,
        1 => RitoPageTurnPhase.landing,
        _ => RitoPageTurnPhase.returning,
      },
      velocity: state[13],
      touch: state[14] == 1
          ? RitoPageTurnTouch(
              origin: Offset(state[15], state[16]),
              position: Offset(state[17], state[18]),
              farthest: Offset(state[19], state[20]),
            )
          : null,
    );
  }

  /// How turns move, in place of the physics the effect brings and of the
  /// built-in rules; null leaves them (see [effectivePhysics]).
  RitoPageTurnPhysics? get physics => _physics;
  set physics(RitoPageTurnPhysics? value) {
    _physics = value;
    _configure();
  }

  RitoPageTurnPhysics? _physics;

  /// How turns move now: [physics], else the physics [effectiveEffect]
  /// brings, else the built-in rules.
  RitoPageTurnPhysics get effectivePhysics =>
      _physics ?? effectiveEffect.physics ?? const RitoPageTurnPhysics();

  /// The configured effect; see [effectiveEffect].
  RitoPageTurnEffect get effect => _effect;
  set effect(RitoPageTurnEffect value) {
    if (identical(value, _effect)) return;
    _effect = value;
    _configure();
    _scheduleWarm();
    notifyListeners();
    _effectChanged();
  }

  /// Whether the system asks for reduced motion ([RitoPageTurnView] keeps
  /// it in step with the platform).
  bool get reduceMotion => _reduceMotion;
  set reduceMotion(bool value) {
    if (value == _reduceMotion) return;
    _reduceMotion = value;
    _configure();
    notifyListeners();
    _effectChanged();
  }

  /// What turns look like now: the [effect], or a cross-fade under
  /// [reduceMotion].
  RitoPageTurnEffect get effectiveEffect =>
      _reduceMotion && respectReducedMotion
      ? RitoPageTurnEffects.fade
      : _effect;

  /// The page width a turn travels (logical px).
  double get width => _width;
  set width(double value) {
    _width = value;
    _configure();
  }

  void _configure() {
    _native.physics.setAll(0, ritoTurnPhysicsNumbers(effectivePhysics));
    _native.configure(_width, instant: effectiveEffect.instant);
  }

  // --- What the host knows of the pages -----------------------------

  /// Writes what is known of the pages beside the one shown, for the
  /// engine's next call.
  void _tell() {
    final pages = _native.pages;
    final effect = effectiveEffect;
    for (final (index, direction) in const [
      (0, RitoAdjacentDirection.next),
      (1, RitoAdjacentDirection.previous),
    ]) {
      final slot = _slotOf(direction);
      final page = textures.page(slot);
      final navigation = page?.artifact.navigation;
      final beyond =
          navigation == null ||
          (direction == RitoAdjacentDirection.next
                  ? navigation.next
                  : navigation.previous) !=
              RitoAdjacentAvailability.terminal;
      pages[index] = reader.canTurn(direction) ? 1 : 0;
      pages[2 + index] = page != null ? 1 : 0;
      pages[4 + index] =
          effect.repaint == null || effect.canDraw(textures, slot) ? 1 : 0;
      pages[6 + index] = beyond ? 1 : 0;
    }
  }

  /// Carries out what the engine asks: answers its questions with the
  /// physics, then takes its actions.
  void _drain() {
    while (!_disposed) {
      final state = _state;
      if (state[3] == 1) {
        _native.answerBegin(_begins(state));
        continue;
      }
      if (state[3] == 2) {
        _native.answerLands(_lands(state));
        continue;
      }
      if (!_native.takeAction()) break;
      _act(_native.action);
    }
    if (_disposed) return;
    _followSettle();
    if (isMoving || isTurning) _run();
  }

  ({double offset, double velocity})? _begins(Float64List state) {
    final forward = state[7] == 1;
    final hasIncoming = state[8] == 1;
    final own = !hasIncoming ? null : (forward ? 1.0 : 2.0);
    return effectivePhysics.begins(
      RitoPageTurnLeftover(
        offset: state[4],
        velocity: state[5],
        width: _width,
        forward: forward,
        samePages: state[6] == own,
      ),
    );
  }

  bool? _lands(Float64List state) => effectivePhysics.lands(
    RitoPageTurnRelease(
      offset: state[4],
      from: state[5],
      velocity: state[6],
      width: state[7],
      forward: state[8] == 1,
      touch: frame.touch,
    ),
  );

  void _act(Float64List action) {
    final direction = action[1] == 0
        ? RitoAdjacentDirection.next
        : RitoAdjacentDirection.previous;
    switch (action[0]) {
      case 1:
        _started(direction);
      case 2:
        _ended(direction, switch (action[2]) {
          0 => RitoPageTurnOutcome.committed,
          1 => RitoPageTurnOutcome.cancelled,
          _ => RitoPageTurnOutcome.interrupted,
        }, carries: action[3] == 1);
      case 3:
        _land(direction);
      case 4:
        _fetchNeighbour(direction, reveal: false, then: _pagesChanged);
      case 5:
        _waitForEffect(action[4]);
      case 6:
        // What was left of a turn came to rest with nothing having taken it
        // up: the page it left is no longer in the frame.
        textures.clear(except: {RitoPageSlot.current});
        _prewarm();
    }
  }

  /// Starts the physics' own motion when the engine has started one for
  /// them to carry; none leaves it to the spring.
  void _followSettle() {
    final state = _state;
    final phase = state[21];
    if ((phase != 2 && phase != 3) || state[21 + 14] == _settleGeneration) {
      return;
    }
    _settleGeneration = state[21 + 14];
    _settle = effectivePhysics.settle(
      from: state[21 + 15],
      velocity: state[21 + 16],
      to: state[21 + 17],
    );
  }

  // --- Fingers, keys and jumps --------------------------------------

  /// A finger came down on the page at [position], in the coordinates the
  /// turn is painted in ([RitoPageTurnView]'s own), and has moved far
  /// enough to mean a drag: where and when it came down is where and when
  /// it took hold, and its speed is measured from there. On a turn already
  /// on screen it cuts into it, and takes the page once that turn is over.
  /// [at] is when it came down (the down event's `timeStamp`); left out,
  /// the controller's own clock tells, for this and every later sample.
  void dragStart(Offset position, {Duration? at}) {
    _dragOrigin = position;
    _lastPosition = position;
    _dragAt = _ms(at);
    _tell();
    _native.fingerDown(position.dx, position.dy, _dragAt);
    _drain();
  }

  /// The finger is at [position], at [at].
  void dragUpdate(Offset position, {Duration? at}) {
    _dragAt = _ms(at);
    _lastPosition = position;
    final travel = _travel(position);
    _tell();
    _native.fingerMove(
      position.dx,
      position.dy,
      travel,
      effectivePhysics.resist(travel, _width),
      _dragAt,
    );
    _drain();
    notifyListeners();
  }

  /// The finger lifted at [position], at [at]; the turn goes on as fast
  /// as the finger was carrying it.
  void dragEnd({Offset? position, Duration? at}) {
    if (position != null) {
      _lastPosition = position;
      _dragAt = _ms(at);
    }
    _tell();
    _native.fingerUp(
      _lastPosition.dx,
      _lastPosition.dy,
      _travel(_lastPosition),
      _dragAt,
    );
    _drain();
  }

  /// The drag was taken away (another gesture won); the page goes back.
  void dragCancel() {
    _tell();
    _native.fingerCancel();
    _drain();
  }

  double _travel(Offset position) =>
      effectivePhysics.travelAcross(_dragOrigin, position, _width);

  /// [at] in ms, or the controller's clock when a caller does not say.
  double _ms(Duration? at) =>
      at == null ? _clock.elapsedMicroseconds / 1000 : at.inMicroseconds / 1000;

  /// Turns to the neighbour in [direction] (a tap, a key). A turn asked for
  /// while another one is on screen cuts into it and begins where its page
  /// is; false at the end of the book, or while a finger holds the page.
  bool turn(RitoAdjacentDirection direction) {
    _tell();
    final taken = _native.command(_index(direction));
    _drain();
    return taken;
  }

  /// Shows the page at [locator]. With [animateAs], the jump plays as a
  /// turn in that direction from the page on screen.
  Future<RitoPreparedArtifact?> jumpTo(
    RitoLocator locator, {
    RitoAdjacentDirection? animateAs,
  }) async {
    if (animateAs == null || isTurning) return reader.jumpTo(locator);
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
    if (page == null || isTurning || _disposed) return page;
    textures.clear(except: {RitoPageSlot.current});
    textures.assign(_slotOf(animateAs), page, jump: true);
    _landed = page;
    _jumping = true;
    _tell();
    _native.playJump(_index(animateAs));
    _drain();
    _jumping = false;
    return page;
  }

  /// Redraws every page texture (a theme or highlight change).
  void invalidatePages() => textures.invalidate();

  // --- What the engine asks -----------------------------------------

  void _started(RitoAdjacentDirection direction) {
    _stopWaitingForEffect();
    _releasePagination ??= reader.holdPagination();
    if (!_jumping) {
      _landed = null;
      textures.assign(RitoPageSlot.current, reader.page);
      // Rasterize the page on screen before the turn can release it.
      textures.image(RitoPageSlot.current);
    }
    if (reader.canTurn(direction) &&
        textures.page(_slotOf(direction)) == null) {
      _fetchNeighbour(direction, reveal: false);
    }
    _events.add(RitoPageTurnStarted(direction));
  }

  void _ended(
    RitoAdjacentDirection direction,
    RitoPageTurnOutcome outcome, {
    required bool carries,
  }) {
    final landed = _landed;
    if (outcome == RitoPageTurnOutcome.committed && landed != null) {
      final incoming = _slotOf(direction);
      if (carries) {
        // The page it left is still in the frame: its image stays beside
        // the page it landed on.
        textures.move(RitoPageSlot.current, _slotOf(_opposite(direction)));
      } else {
        textures.clear(except: {incoming});
      }
      textures.move(incoming, RitoPageSlot.current);
      textures.assign(RitoPageSlot.current, landed);
    }
    _landed = null;
    _releasePagination?.call();
    _releasePagination = null;
    notifyListeners();
    _events.add(RitoPageTurnEnded(direction, outcome));
    if (!isTurning && !isMoving) _prewarm();
  }

  /// Lands the decided turn on the reader while the animation plays.
  void _land(RitoAdjacentDirection direction) {
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
          if (_disposed) return;
          _tell();
          _native.landed(ok: _landed != null);
          _drain();
        });
  }

  /// A page the engine asked for arrived (or will not).
  void _pagesChanged(RitoAdjacentDirection direction, {required bool there}) {
    if (_disposed) return;
    _tell();
    _native.pagesChanged();
    _drain();
  }

  /// Listens for the effect, and starts the clock on the wait.
  void _waitForEffect(double seconds) {
    _effectTimer?.cancel();
    _effectTimer = Timer(Duration(microseconds: (seconds * 1e6).round()), () {
      _effectTimer = null;
      if (_disposed) return;
      _tell();
      _native.overdue();
      _drain();
    });
    final repaint = effectiveEffect.repaint;
    if (identical(repaint, _waitingOn)) return;
    _waitingOn?.removeListener(_effectChanged);
    _waitingOn = repaint?..addListener(_effectChanged);
  }

  /// The wait for the effect is over: the turn began, or will not.
  void _stopWaitingForEffect() {
    _waitingOn?.removeListener(_effectChanged);
    _waitingOn = null;
    _effectTimer?.cancel();
    _effectTimer = null;
  }

  /// The effect may be able to draw what waits for it now.
  void _effectChanged() {
    if (_disposed) return;
    _tell();
    _native.pagesChanged();
    _drain();
  }

  // --- Frames ---------------------------------------------------------

  void _run() {
    notifyListeners();
    if (!_ticker.isActive) {
      _lastTick = null;
      unawaited(_ticker.start());
    }
  }

  /// A frame a vsync while a turn is open or anything moves, held by a
  /// finger or not, as the web's loop runs: the first step of a loop that
  /// had stopped is a frame long, and no step is longer than two.
  void _tick(Duration elapsed) {
    final last = _lastTick;
    final seconds = last == null
        ? 0.016
        : math.min((elapsed - last).inMicroseconds / 1e6, 0.032);
    _lastTick = elapsed;
    final settle = _settle;
    final at = _state[21 + 8] + seconds;
    _tell();
    _native.step(
      seconds,
      host: settle == null
          ? null
          : (x: settle.x(at), velocity: settle.dx(at), done: settle.isDone(at)),
    );
    _drain();
    final fading = textures.advanceReveal(seconds);
    notifyListeners();
    if (!isMoving && !fading && !isTurning) {
      _ticker.stop();
      _lastTick = null;
    }
  }

  void _texturesChanged() {
    notifyListeners();
    _scheduleWarm();
  }

  // --- The reader -----------------------------------------------------

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
      final open = direction;
      textures.assign(RitoPageSlot.current, reader.page);
      if (open != null && reader.canTurn(open)) {
        _fetchNeighbour(open, reveal: true);
      }
      if (open == null) _prewarm();
      // A turn waiting for a page of the old numbering waits for the new.
      _tell();
      _native.pagesChanged();
      _drain();
      return;
    }
    // Something else moved the reader (a jump, a relayout): nothing that
    // was on its way carries on, a finger's drag included.
    _stopWaitingForEffect();
    _native.interrupt();
    _drain();
    _prewarm();
  }

  void _prewarm() {
    if (!prewarm || isTurning) return;
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
    if (_disposed || isMoving || isTurning) return;
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
    // Every page is painted: the effect may copy them where it draws from.
    effectiveEffect.warm(textures);
  }

  void _fetchNeighbour(
    RitoAdjacentDirection direction, {
    required bool reveal,
    void Function(RitoAdjacentDirection direction, {required bool there})? then,
  }) {
    final revision = reader.revision;
    reader
        .neighbour(direction)
        .then<void>(
          (page) {
            if (revision != reader.revision || _disposed) return;
            if (page == null) {
              then?.call(direction, there: false);
              return;
            }
            final shown = reveal && this.direction == direction;
            textures.assign(_slotOf(direction), page, reveal: shown);
            if (shown) _run();
            then?.call(direction, there: true);
          },
          onError: (Object error, StackTrace stack) {
            _report(error, stack);
            // A turn waiting for the page will not have it.
            if (revision == reader.revision && !_disposed) {
              then?.call(direction, there: false);
            }
          },
        );
  }

  static int _index(RitoAdjacentDirection direction) =>
      direction == RitoAdjacentDirection.next ? 0 : 1;

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
    _stopWaitingForEffect();
    reader.removeListener(_readerChanged);
    _native.interrupt();
    while (_native.takeAction()) {
      final action = _native.action;
      if (action[0] == 2) {
        _events.add(
          RitoPageTurnEnded(
            action[1] == 0
                ? RitoAdjacentDirection.next
                : RitoAdjacentDirection.previous,
            RitoPageTurnOutcome.interrupted,
          ),
        );
      }
    }
    _releasePagination?.call();
    _releasePagination = null;
    _native.dispose();
    _ticker.dispose();
    textures.dispose();
    unawaited(_events.close());
    super.dispose();
  }
}
