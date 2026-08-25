part of 'artifact_image_cache.dart';

final class _ImagePrepareRollbackFailure implements Exception {
  const _ImagePrepareRollbackFailure(this.prepareError, this.rollbackError);

  final Object prepareError;
  final Object rollbackError;

  @override
  String toString() {
    return 'Image preparation failed ($prepareError), and lease rollback also '
        'failed ($rollbackError).';
  }
}

/// One artifact's synchronous, paint-ready image resolver.
final class RitoArtifactImageLease {
  RitoArtifactImageLease._({
    required RitoArtifactImageCache owner,
    required this.sessionId,
    required this.artifactId,
    required Map<String, _CacheKey> images,
    required this.failedImages,
  }) : _owner = owner,
       _images = images;

  final RitoArtifactImageCache _owner;
  final Map<String, _CacheKey> _images;
  final int sessionId;
  final int artifactId;

  /// Images whose preparation failed, by href, with the fault that was
  /// reported. They paint as absence; the page still turns.
  final Map<String, Object> failedImages;

  bool _released = false;

  bool get isReleased => _released;

  /// Returns a borrowed image for immediate synchronous Canvas replay,
  /// or null for an image whose preparation failed and was recorded.
  ///
  /// Callers must not retain or dispose it. Ownership remains with this lease.
  ui.Image? resolveImage(String href) {
    if (_released) {
      throw StateError('Artifact image lease has been released.');
    }
    final key = _images[href];
    if (key == null) {
      if (failedImages.containsKey(href)) {
        return null;
      }
      throw StateError('Image was not prepared for this artifact: $href');
    }
    return _owner._resolve(key);
  }

  void release() {
    if (_released) {
      return;
    }
    _released = true;
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
