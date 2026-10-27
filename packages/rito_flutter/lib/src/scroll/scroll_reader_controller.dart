import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import '../font/artifact_font_cache.dart';
import '../protocol/request_models.dart';
import '../protocol/revision_layout.dart';
import '../reader/page_source.dart';
import '../reader_session.dart';
import 'scroll_windows.dart';

/// A window's artifact as the scroll view holds it: [committable] while the
/// session can still make it the visible page (it was peeked and not yet
/// committed).
final class _Held {
  _Held(this.artifact, {required this.committable});

  final RitoPreparedArtifact artifact;
  bool committable;
}

/// The state behind a [RitoScrollReaderView]: a scrolled revision's windows,
/// the artifacts of the ones near the reading line, and which window the
/// reader reads.
///
/// It runs the session's work one operation at a time; it loads a window
/// when the view asks for it and lets go of the ones far from the reading
/// line; the window under the reading line becomes the session's visible
/// page; and it lays the rest of the book out in the background, taking
/// the whole book's windows when that layout catches up. Listeners hear
/// every change of [windows] and every window that lands.
///
/// The controller does not own the session: dispose the controller, then
/// the session.
final class RitoScrollReaderController extends ChangeNotifier {
  RitoScrollReaderController(
    this.session, {
    required RitoLayoutRequest layout,
    required this.devicePixelRatio,
    this.paginationQuantum = 4,
    bool layOutBook = true,
  }) : _layout = layout,
       _visible = session.firstArtifact,
       _reading = session.firstArtifact.artifact.localSpreadIndex,
       _paginationComplete = !layOutBook {
    unawaited(_enqueue(_takeLayout));
    unawaited(
      SchedulerBinding.instance.endOfFrame.then((_) => _schedulePagination()),
    );
  }

  final RitoReaderSession session;

  /// Device pixels a logical pixel of the screen the view draws on.
  final double devicePixelRatio;

  /// The most pages a background pagination step lays out.
  final int paginationQuantum;

  /// Windows further than this from the reading window are let go.
  static const int reach = 2;

  final RitoLayoutRequest _layout;
  RitoPreparedArtifact _visible;
  RitoScrollWindows? _windows;
  int _reading;
  final Map<int, _Held> _held = <int, _Held>{};
  final Set<int> _loading = <int>{};
  Future<void> _queue = Future<void>.value();

  /// Whether the book is laid out behind the reader: done, failed and
  /// reported, or not asked for (`layOutBook: false` reads one chapter).
  bool _paginationComplete;
  bool _disposed = false;

  /// The windows of the layout the reader reads; null until it is read.
  RitoScrollWindows? get windows => _windows;

  /// The window the reading line is in: the session's visible page.
  int get readingSpread => _reading;

  /// The page on the session's screen.
  RitoPreparedArtifact get visible => _visible;

  /// Where the reading line sits in the viewport, in device pixels: the
  /// content box's block start.
  double get readingLine =>
      (_windows?.axis == RitoScrollAxis.left
          ? _layout.marginRight
          : _layout.marginTop) *
      devicePixelRatio;

  /// The artifact of window [spreadIndex]; null while it loads, and the
  /// listeners hear when it lands. Only windows near the reading line load.
  RitoPreparedArtifact? windowArtifact(int spreadIndex) {
    if (spreadIndex == _visible.artifact.localSpreadIndex) return _visible;
    final held = _held[spreadIndex];
    if (held != null) return held.artifact;
    if ((spreadIndex - _reading).abs() <= reach && _loading.add(spreadIndex)) {
      unawaited(_enqueue(() => _load(spreadIndex)));
    }
    return null;
  }

  /// The strip is at device offset [offset]: the window under the reading
  /// line becomes the visible page.
  void read(double offset) {
    final window = _windows?.windowAt(offset + readingLine);
    if (window == null || window.spreadIndex == _reading) return;
    _reading = window.spreadIndex;
    unawaited(_enqueue(_commitReading));
  }

  Future<void> _takeLayout() async {
    if (_disposed) return;
    // What is laid out so far: the chapter read first, or the whole book
    // once its layout is taken, which holds every page from the start.
    final layout = await session.revisionLayout(_visible, whole: false);
    final windows = RitoScrollWindows.of(
      layout,
      windowLength: layout.scrollAxis == RitoScrollAxis.left
          ? _layout.viewportWidth
          : _layout.viewportHeight,
      ratio: devicePixelRatio,
    );
    if (windows == null || _disposed) return;
    _windows = windows;
    _reading = _visible.artifact.localSpreadIndex;
    notifyListeners();
  }

  Future<void> _load(int spreadIndex) async {
    try {
      if (_disposed || (spreadIndex - _reading).abs() > reach) return;
      final peeked = await session.peekSpread(
        from: _visible,
        requestId: session.takeRequestId(),
        spreadIndex: spreadIndex,
      );
      _held[spreadIndex] = _Held(peeked, committable: true);
      if (!_disposed) notifyListeners();
    } on Object catch (error, stack) {
      _report(error, stack, 'loading a scrolled window');
    } finally {
      _loading.remove(spreadIndex);
    }
  }

  /// Makes the reading window the visible page, and lets go of the windows
  /// that are no longer near it.
  Future<void> _commitReading() async {
    final target = _reading;
    if (_disposed || target == _visible.artifact.localSpreadIndex) return;
    try {
      var held = _held[target];
      if (held == null || !held.committable) {
        final peeked = await session.peekSpread(
          from: _visible,
          requestId: session.takeRequestId(),
          spreadIndex: target,
        );
        if (held != null) await _releaseQuietly(held.artifact);
        held = _Held(peeked, committable: true);
      }
      _held.remove(target);
      final previous = _visible;
      _visible = await session.commitSpread(
        from: previous,
        spread: held.artifact,
      );
      _held[previous.artifact.localSpreadIndex] = _Held(
        previous,
        committable: false,
      );
      await _releaseFar();
      if (!_disposed) notifyListeners();
    } on Object catch (error, stack) {
      _report(error, stack, 'reading a scrolled window');
    }
  }

  Future<void> _releaseFar() async {
    final far = _held.entries
        .where((entry) => (entry.key - _reading).abs() > reach)
        .toList();
    for (final entry in far) {
      _held.remove(entry.key);
      await _releaseQuietly(entry.value.artifact);
    }
  }

  void _schedulePagination() {
    if (_paginationComplete || _disposed) return;
    // Each step waits for the isolate's next task, so the frames and input
    // that came in meanwhile go first.
    Timer(Duration.zero, () {
      if (_paginationComplete || _disposed) return;
      unawaited(_enqueue(_paginateOnce).then((_) => _schedulePagination()));
    });
  }

  Future<void> _paginateOnce() async {
    if (_paginationComplete || _disposed) return;
    try {
      final step = await RitoSessionPageSource(
        session,
      ).paginate(_visible, paginationQuantum);
      final adopted = step.adopted;
      if (adopted != null) await _adopt(adopted);
      if (step.complete) _paginationComplete = true;
    } on Object catch (error, stack) {
      // The book stays readable chapter by chapter without it.
      _paginationComplete = true;
      _report(error, stack, 'laying the book out in the background');
    }
  }

  /// The whole book's layout caught up: its windows replace the chapter's,
  /// and the windows held for the chapter are let go.
  Future<void> _adopt(RitoPreparedArtifact adopted) async {
    final previous = _visible;
    _visible = adopted;
    final stale = _held.values.map((held) => held.artifact).toList();
    _held.clear();
    for (final artifact in <RitoPreparedArtifact>[previous, ...stale]) {
      if (!identical(artifact, adopted)) await _releaseQuietly(artifact);
    }
    await _takeLayout();
  }

  Future<void> _releaseQuietly(RitoPreparedArtifact artifact) async {
    try {
      await session.releaseArtifact(artifact);
    } on Object catch (error, stack) {
      _report(error, stack, 'releasing a scrolled window');
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

  /// Stops background layout and lets go of the held windows. The visible
  /// page stays with the session.
  @override
  void dispose() {
    _disposed = true;
    final held = _held.values.map((entry) => entry.artifact).toList();
    _held.clear();
    for (final artifact in held) {
      unawaited(_enqueue(() => _releaseQuietly(artifact)));
    }
    super.dispose();
  }
}
