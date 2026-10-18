import 'dart:async';

import 'package:flutter/foundation.dart';

import '../font/artifact_font_cache.dart';
import '../protocol/artifact_models.dart';
import '../protocol/request_models.dart';
import '../reader_session.dart';
import 'page_source.dart';

/// Why [RitoReaderController.page] last changed.
enum RitoPageChange {
  /// A turn to a neighbour.
  turn,

  /// A jump to a locator.
  jump,

  /// The book was laid out again.
  relayout,

  /// Background pagination renumbered the same page onto the whole-book
  /// layout; the reader sees the same content.
  pagination,
}

/// Owns the page a [RitoReaderSession] shows and everything whose lifetime
/// follows it.
///
/// It runs the session's work one operation at a time; turns, jumps and
/// relayouts replace the visible page and release the one they replaced;
/// it keeps the neighbours it peeked for the current page and releases
/// them when the page changes; and it paginates the rest of the book in
/// the background, adopting the renumbered page when the whole-book
/// layout catches up. Listeners hear every change of [page].
///
/// The controller does not own the session: dispose the controller, then
/// the session.
final class RitoReaderController extends ChangeNotifier {
  RitoReaderController(
    RitoReaderSession session, {
    required RitoLayoutRequest layout,
    int paginationQuantum = defaultPaginationQuantum,
  }) : this.withSource(
         RitoSessionPageSource(session),
         layout: layout,
         paginationQuantum: paginationQuantum,
       );

  /// A controller over any [RitoPageSource]; tests drive it with a fake.
  @visibleForTesting
  RitoReaderController.withSource(
    this._source, {
    required RitoLayoutRequest layout,
    this.paginationQuantum = defaultPaginationQuantum,
  }) : _layout = layout,
       _page = _source.firstPage {
    _schedulePagination();
  }

  final RitoPageSource _source;

  /// The most pages a background pagination quantum lays out.
  final int paginationQuantum;

  /// The engine runs on the isolate that paints, so a quantum is what
  /// stands between two frames: a few pages, the engine's
  /// `READER_FRAME_QUANTUM_PAGES`.
  static const int defaultPaginationQuantum = 4;

  /// How long the layout must go unchanged after a [relayout] before the
  /// rest of the book is paginated behind it: pages laid out behind a size
  /// the next one replaces are thrown away, so while a window is being
  /// resized the book waits: the engine's `READER_RELAYOUT_SETTLE_MS`.
  static const Duration layoutSettle = Duration(milliseconds: 300);

  RitoLayoutRequest _layout;
  RitoPreparedArtifact _page;
  int _revision = 0;
  RitoPageChange? _lastChange;
  final Map<RitoAdjacentDirection, _Neighbour> _neighbours = {};
  Future<void> _queue = Future<void>.value();
  int _seekGeneration = 0;
  int _paginationHolds = 0;
  bool _paginationComplete = false;
  Timer? _paginationStep;
  Timer? _layoutSettling;
  bool _disposed = false;

  /// The page on screen. It stays live until the controller replaces it.
  RitoPreparedArtifact get page => _page;

  /// Counts replacements of [page]; anything derived from a page (a
  /// texture, a cached neighbour) is current only for its revision.
  int get revision => _revision;

  /// Why [page] last changed; null before it first does.
  RitoPageChange? get lastChange => _lastChange;

  /// The layout pages are laid out with.
  RitoLayoutRequest get layout => _layout;

  /// Whether background pagination has stopped: the whole book is laid
  /// out, or a step failed and was reported.
  bool get paginationComplete => _paginationComplete;

  /// Whether [page] has a neighbour in [direction] (false at the first or
  /// last page of the book).
  bool canTurn(RitoAdjacentDirection direction) {
    final navigation = _page.artifact.navigation;
    final availability = direction == RitoAdjacentDirection.next
        ? navigation.next
        : navigation.previous;
    return availability != RitoAdjacentAvailability.terminal;
  }

  /// The neighbour of [page] in [direction], laid out and prepared but not
  /// shown, or null at the end of the book or once [page] has changed. The
  /// controller owns it: it is the page a [turn] that way lands on, at no
  /// further cost, and it is released when [page] changes.
  Future<RitoPreparedArtifact?> neighbour(RitoAdjacentDirection direction) {
    final cached = _neighbours[direction];
    if (cached != null) return cached.page;
    if (!canTurn(direction)) return Future<RitoPreparedArtifact?>.value();
    final revision = _revision;
    final page = _enqueue<RitoPreparedArtifact?>(() async {
      if (revision != _revision || _disposed) return null;
      return _source.peek(_page, direction);
    });
    final entry = _Neighbour(page);
    _neighbours[direction] = entry;
    // A failed peek is forgotten so the next ask tries again.
    page.then<void>(
      (_) {},
      onError: (Object _) {
        if (identical(_neighbours[direction], entry)) {
          _neighbours.remove(direction);
        }
      },
    );
    return page;
  }

  /// Shows the neighbour in [direction]; null at the end of the book.
  Future<RitoPreparedArtifact?> turn(RitoAdjacentDirection direction) {
    return _enqueue(() async {
      if (_disposed || !canTurn(direction)) return null;
      final next = await _source.turn(_page, direction);
      await _replace(next, RitoPageChange.turn);
      return next;
    });
  }

  /// Shows the page at [locator]. Null when a later [jumpTo] or [relayout]
  /// superseded this one before it ran.
  Future<RitoPreparedArtifact?> jumpTo(RitoLocator locator) {
    return _seek(() => locator, RitoPageChange.jump);
  }

  /// Lays the book out again with [layout] and shows the page the reader
  /// was on. Null when a later [jumpTo] or [relayout] superseded it.
  Future<RitoPreparedArtifact?> relayout(RitoLayoutRequest layout) {
    _layout = layout;
    _layoutSettling?.cancel();
    _layoutSettling = Timer(layoutSettle, () {
      _layoutSettling = null;
      _schedulePagination();
    });
    return _seek(() => _page.artifact.locator, RitoPageChange.relayout);
  }

  /// Runs [action] in turn with the controller's other session work, with
  /// [page] guaranteed live until it finishes — for reads against the page
  /// such as resources, footnotes or text geometry.
  Future<T> withPage<T>(Future<T> Function(RitoPreparedArtifact page) action) {
    return _enqueue(() => action(_page));
  }

  /// Pauses background pagination until the returned callback is called
  /// (a page turn in progress, an interaction that must not compete with
  /// layout work). Holds nest.
  VoidCallback holdPagination() {
    _paginationHolds += 1;
    var released = false;
    return () {
      if (released) return;
      released = true;
      _paginationHolds -= 1;
      _schedulePagination();
    };
  }

  Future<RitoPreparedArtifact?> _seek(
    RitoLocator Function() locator,
    RitoPageChange change,
  ) {
    final generation = ++_seekGeneration;
    return _enqueue(() async {
      if (_disposed || generation != _seekGeneration) return null;
      final next = await _source.seek(_layout, locator());
      await _replace(next, change);
      _paginationComplete = false;
      _schedulePagination();
      return next;
    });
  }

  /// Makes [next] the visible page and releases what belonged to the old
  /// one: the page itself and the neighbours peeked from it (except [next],
  /// when the turn landed on a peeked neighbour).
  Future<void> _replace(
    RitoPreparedArtifact next,
    RitoPageChange change,
  ) async {
    final previous = _page;
    _lastChange = change;
    _releaseNeighbours(keep: next);
    _page = next;
    _revision += 1;
    if (!_disposed) notifyListeners();
    if (!identical(previous, next)) await _releaseQuietly(previous);
  }

  /// Forgets the cached neighbours and releases each once it resolves. A
  /// peek may still sit behind the running operation in the queue, so this
  /// never waits for one: it queues the release when the peek lands.
  void _releaseNeighbours({RitoPreparedArtifact? keep}) {
    final stale = _neighbours.values.map((entry) => entry.page).toList();
    _neighbours.clear();
    for (final neighbour in stale) {
      neighbour.then<void>((peeked) {
        if (peeked == null || identical(peeked, keep)) return;
        unawaited(_enqueue(() => _releaseQuietly(peeked)));
      }, onError: (Object _) {});
    }
  }

  Future<void> _releaseQuietly(RitoPreparedArtifact page) async {
    try {
      await _source.release(page);
    } on Object catch (error, stack) {
      _report(error, stack, 'releasing a page the reader no longer shows');
    }
  }

  void _schedulePagination() {
    if (_paginationStep != null ||
        _paginationComplete ||
        _paginationHolds > 0 ||
        _layoutSettling != null ||
        _disposed) {
      return;
    }
    // Each step waits for the isolate's next task, so the frames and input
    // that came in meanwhile go first: the steps are the reader's idle time.
    _paginationStep = Timer(Duration.zero, () {
      _paginationStep = null;
      if (_paginationHolds > 0 ||
          _paginationComplete ||
          _layoutSettling != null ||
          _disposed) {
        return;
      }
      unawaited(_enqueue(_paginateOnce).then((_) => _schedulePagination()));
    });
  }

  Future<void> _paginateOnce() async {
    if (_paginationHolds > 0 ||
        _paginationComplete ||
        _layoutSettling != null ||
        _disposed) {
      return;
    }
    try {
      final step = await _source.paginate(_page, paginationQuantum);
      final adopted = step.adopted;
      if (adopted != null) await _replace(adopted, RitoPageChange.pagination);
      if (step.complete) _paginationComplete = true;
    } on Object catch (error, stack) {
      // The book stays readable chapter by chapter without it.
      _paginationComplete = true;
      _report(error, stack, 'paginating the book in the background');
    }
  }

  Future<T> _enqueue<T>(Future<T> Function() operation) {
    final run = _queue.then((_) => operation());
    _queue = run.then<void>((_) {}, onError: (Object _) {});
    return run;
  }

  void _report(Object error, StackTrace stack, String context) {
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stack,
        library: 'rito_flutter',
        context: ErrorDescription(context),
      ),
    );
  }

  /// Stops background pagination and releases the peeked neighbours. The
  /// visible page stays with the session.
  @override
  void dispose() {
    _disposed = true;
    _layoutSettling?.cancel();
    _paginationStep?.cancel();
    _paginationStep = null;
    _releaseNeighbours();
    super.dispose();
  }
}

final class _Neighbour {
  _Neighbour(this.page);

  final Future<RitoPreparedArtifact?> page;
}
