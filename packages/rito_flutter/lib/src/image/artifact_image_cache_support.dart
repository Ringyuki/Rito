part of 'artifact_image_cache.dart';

/// A read that failed for a reason that can pass: the host could not
/// deliver the resource this time (its shard did not load). The lease reads
/// the image again; anything else an image fails with is final.
final class RitoTransientResourceFailure implements Exception {
  const RitoTransientResourceFailure(this.cause);

  final Object cause;

  @override
  String toString() => 'RitoTransientResourceFailure: $cause';
}

/// One artifact's synchronous, paint-ready image resolver, filled in as
/// its images land.
///
/// An image under a second on its way paints nothing; past a second its
/// loading placeholder paints, and once it lands it fades in over that
/// placeholder in 150ms. An image that failed paints its broken
/// placeholder. One that failed for a reason that can pass is read again
/// after 2s, 5s and then every 15s while a page listens to the lease, and
/// at once when a page starts listening again. Listeners hear every change.
final class RitoArtifactImageLease extends ChangeNotifier {
  RitoArtifactImageLease._({
    required RitoArtifactImageCache owner,
    required this.sessionId,
    required this.artifactId,
    required Set<String> hrefs,
    required Future<_CacheKey> Function(String href) load,
  }) : _owner = owner,
       _hrefs = hrefs,
       _load = load,
       _unsettled = Set<String>.of(hrefs);

  static const Duration placeholderDelay = Duration(seconds: 1);
  static const Duration fadeDuration = Duration(milliseconds: 150);
  static const List<Duration> _retryDelays = <Duration>[
    Duration(seconds: 2),
    Duration(seconds: 5),
    Duration(seconds: 15),
  ];
  static const Duration _fadeStep = Duration(milliseconds: 16);

  final RitoArtifactImageCache _owner;
  final Set<String> _hrefs;
  final Future<_CacheKey> Function(String href) _load;
  final Map<String, _CacheKey> _images = <String, _CacheKey>{};
  final Map<String, Object> _failed = <String, Object>{};
  final Set<String> _unsettled;
  final Completer<void> _settled = Completer<void>();
  final Set<String> _placeholderShown = <String>{};
  final Map<String, Timer> _placeholderTimers = <String, Timer>{};
  final Map<String, double> _fading = <String, double>{};
  final Map<String, int> _retryAttempts = <String, int>{};
  final Map<String, Timer> _retryTimers = <String, Timer>{};
  final Set<String> _retriesDue = <String>{};
  Timer? _fadeTicker;
  final int sessionId;
  final int artifactId;

  bool _released = false;

  bool get isReleased => _released;

  /// Images whose preparation failed, by href, with the fault that was
  /// reported. They paint their broken placeholder; the page still turns.
  Map<String, Object> get failedImages =>
      Map<String, Object>.unmodifiable(_failed);

  /// Completes once every image has landed or failed at least once.
  Future<void> get settled => _settled.future;

  /// Returns a borrowed image for immediate synchronous Canvas replay,
  /// or null for an image still on its way or failed.
  ///
  /// Callers must not retain or dispose it. Ownership remains with this lease.
  ui.Image? resolveImage(String href) {
    if (_released) {
      throw StateError('Artifact image lease has been released.');
    }
    final key = _images[href];
    if (key != null) {
      return _owner._resolve(key);
    }
    if (_hrefs.contains(href)) {
      return null;
    }
    throw StateError('Image was not prepared for this artifact: $href');
  }

  /// The placeholder that stands in [href]'s place now, if any.
  RitoImageFallbackState? fallbackState(String href) {
    if (_images.containsKey(href)) {
      return _fading.containsKey(href) ? RitoImageFallbackState.loading : null;
    }
    if (_failed.containsKey(href)) {
      return RitoImageFallbackState.broken;
    }
    return _placeholderShown.contains(href)
        ? RitoImageFallbackState.loading
        : null;
  }

  /// The opacity [href] paints at: below one while it fades in.
  double imageOpacity(String href) => _fading[href] ?? 1;

  @override
  void addListener(VoidCallback listener) {
    super.addListener(listener);
    // A page showing again reads what failed while nobody looked at once.
    for (final href in _retriesDue.toList(growable: false)) {
      _retriesDue.remove(href);
      _retryAttempts[href] = -1;
      _retry(href);
    }
  }

  void _begin() {
    for (final href in _hrefs) {
      _start(href);
    }
    if (_hrefs.isEmpty) {
      _settled.complete();
    }
  }

  void _start(String href) {
    _placeholderTimers[href]?.cancel();
    _placeholderTimers[href] = Timer(placeholderDelay, () {
      if (_released || _images.containsKey(href) || _failed.containsKey(href)) {
        return;
      }
      _placeholderShown.add(href);
      _notify();
    });
    unawaited(
      _load(href).then(
        (key) => _landed(href, key),
        onError: (Object error, StackTrace stackTrace) =>
            _failedWith(href, error, stackTrace),
      ),
    );
  }

  void _landed(String href, _CacheKey key) {
    _placeholderTimers.remove(href)?.cancel();
    if (_released) {
      _owner._release(key);
      return;
    }
    _images[href] = key;
    _retryAttempts.remove(href);
    if (_placeholderShown.remove(href)) {
      _fading[href] = 0;
      _fadeTicker ??= Timer.periodic(_fadeStep, (_) => _stepFades());
    }
    _settle(href);
    _notify();
  }

  void _failedWith(String href, Object error, StackTrace stackTrace) {
    _placeholderTimers.remove(href)?.cancel();
    if (_released || _owner._disposed) {
      _settle(href);
      return;
    }
    _failed[href] = error;
    final retryable = error is RitoTransientResourceFailure;
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'rito_flutter',
        context: ErrorDescription(
          retryable
              ? 'reading artifact image $href; it paints as broken and is '
                    'read again'
              : 'preparing artifact image $href; it paints as broken',
        ),
      ),
    );
    if (retryable) {
      final attempt = (_retryAttempts[href] ?? -1) + 1;
      _retryAttempts[href] = attempt;
      final delay = _retryDelays[math.min(attempt, _retryDelays.length - 1)];
      _retryTimers[href]?.cancel();
      _retryTimers[href] = Timer(delay, () {
        _retryTimers.remove(href);
        if (_released) {
          return;
        }
        if (hasListeners) {
          _retry(href);
        } else {
          _retriesDue.add(href);
        }
      });
    }
    _settle(href);
    _notify();
  }

  void _retry(String href) {
    if (_released || !_failed.containsKey(href)) {
      return;
    }
    _failed.remove(href);
    _placeholderShown.add(href);
    _notify();
    _start(href);
  }

  void _stepFades() {
    if (_released) {
      _fadeTicker?.cancel();
      _fadeTicker = null;
      return;
    }
    final step = _fadeStep.inMicroseconds / fadeDuration.inMicroseconds;
    for (final href in _fading.keys.toList(growable: false)) {
      final opacity = _fading[href]! + step;
      if (opacity >= 1) {
        _fading.remove(href);
      } else {
        _fading[href] = opacity;
      }
    }
    if (_fading.isEmpty) {
      _fadeTicker?.cancel();
      _fadeTicker = null;
    }
    _notify();
  }

  void _settle(String href) {
    if (_unsettled.remove(href) &&
        _unsettled.isEmpty &&
        !_settled.isCompleted) {
      _settled.complete();
    }
  }

  void _notify() {
    if (!_released) {
      notifyListeners();
    }
  }

  void release() {
    if (_released) {
      return;
    }
    _released = true;
    for (final timer in <Timer>[
      ..._placeholderTimers.values,
      ..._retryTimers.values,
    ]) {
      timer.cancel();
    }
    _placeholderTimers.clear();
    _retryTimers.clear();
    _fadeTicker?.cancel();
    _fadeTicker = null;
    if (!_settled.isCompleted) {
      _settled.complete();
    }
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final key in _images.values) {
      try {
        _owner._release(key);
      } on Object catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }
}

final class _ImageEntry {
  _ImageEntry({
    required this.key,
    required this.image,
    required this.sourceWidth,
    required this.sourceHeight,
  });

  final _CacheKey key;
  final ui.Image image;
  final int sourceWidth;
  final int sourceHeight;
  int references = 0;
}

final class _LeaseBudget {
  _LeaseBudget(this.limits);

  final RitoArtifactImageLimits limits;
  int _encodedBytes = 0;
  int _targetPixels = 0;

  void reserveEncoded(int bytes, String href) {
    _encodedBytes += bytes;
    if (_encodedBytes > limits.maxEncodedBytesPerLease) {
      throw RitoImageBudgetExceededException(
        'Encoded images exceed the per-lease byte budget at $href.',
      );
    }
  }

  void reserveTarget(int pixels, String href) {
    _targetPixels += pixels;
    if (_targetPixels > limits.maxTargetPixelsPerLease) {
      throw RitoImageBudgetExceededException(
        'Decoded images exceed the per-lease pixel budget at $href.',
      );
    }
  }
}

final class _ImageWorkLimiter {
  _ImageWorkLimiter(this.limit);

  final int limit;
  final ListQueue<Completer<void>> _waiting = ListQueue<Completer<void>>();
  int _active = 0;
  bool _disposed = false;

  Future<T> run<T>(Future<T> Function() operation) async {
    await _acquire();
    try {
      return await operation();
    } finally {
      _release();
    }
  }

  Future<void> _acquire() {
    if (_disposed) {
      return Future<void>.error(
        StateError('Rito artifact image cache has been disposed.'),
      );
    }
    if (_active < limit) {
      _active += 1;
      return Future<void>.value();
    }
    final waiter = Completer<void>();
    _waiting.addLast(waiter);
    return waiter.future;
  }

  void _release() {
    if (_active > 0) {
      _active -= 1;
    }
    if (_disposed || _waiting.isEmpty) {
      return;
    }
    _active += 1;
    _waiting.removeFirst().complete();
  }

  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    final failure = StateError('Rito artifact image cache has been disposed.');
    while (_waiting.isNotEmpty) {
      _waiting.removeFirst().completeError(failure);
    }
  }
}
