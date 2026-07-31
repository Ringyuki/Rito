import 'dart:async';
import 'dart:collection';
import 'dart:math' as math;
import 'dart:ui' as ui;

import '../protocol/artifact_models.dart';
import '../protocol/display_geometry.dart';
import '../protocol/display_models.dart';
import '../protocol/display_paint.dart';
import 'image_decoder.dart';
import 'image_limits.dart';

part 'artifact_image_cache_support.dart';
part 'artifact_image_cache_validation.dart';
part 'image_target_plan.dart';

typedef RitoArtifactImageResourceReader =
    Future<RitoResource> Function(RitoResourceRef reference);

typedef _SourceKey = ({int sessionId, String href});
typedef _CacheKey = ({
  int sessionId,
  String href,
  int targetWidth,
  int targetHeight,
});

/// Ref-counted cache for paint-ready Flutter images owned by artifact leases.
///
/// Entries exist only while a current or incoming artifact lease references
/// them. The key includes session, canonical resource href, and decode bucket,
/// allowing page-turn animation artifacts to share the same immutable image.
/// The default bucket is 64 pixels, and the concurrency limit is cache-wide
/// across overlapping preparations and cannot be configured above four.
final class RitoArtifactImageCache {
  RitoArtifactImageCache({
    RitoImageDecoder? decoder,
    this.limits = const RitoArtifactImageLimits(),
    this.targetBucketSize = 64,
    this.maxConcurrentDecodes = 4,
  }) : _decoder = decoder ?? const RitoUiImageDecoder(),
       _limiter = _ImageWorkLimiter(maxConcurrentDecodes) {
    limits.validate();
    if (targetBucketSize <= 0) {
      throw ArgumentError.value(
        targetBucketSize,
        'targetBucketSize',
        'must be positive',
      );
    }
    if (maxConcurrentDecodes <= 0 || maxConcurrentDecodes > 4) {
      throw ArgumentError.value(
        maxConcurrentDecodes,
        'maxConcurrentDecodes',
        'must be between one and four',
      );
    }
  }

  final RitoImageDecoder _decoder;
  final _ImageWorkLimiter _limiter;
  final RitoArtifactImageLimits limits;
  final int targetBucketSize;
  final int maxConcurrentDecodes;
  final Map<_CacheKey, _ImageEntry> _entries = <_CacheKey, _ImageEntry>{};
  final Map<_SourceKey, Future<_ImageEntry>> _loads =
      <_SourceKey, Future<_ImageEntry>>{};
  bool _disposed = false;

  Future<RitoArtifactImageLease> prepare({
    required RitoArtifact artifact,
    required RitoArtifactImageResourceReader readResource,
    required double pixelRatio,
  }) async {
    _requireOpen();
    final plan = _ImageTargetPlan.collect(artifact, pixelRatio: pixelRatio);
    final declarations = _imageDeclarations(artifact);
    for (final href in plan.hrefs) {
      if (!declarations.containsKey(href)) {
        throw FormatException(
          'Display list image $href is not declared by the artifact.',
        );
      }
    }
    final budget = _LeaseBudget(limits);
    final acquired = <String, _CacheKey>{};
    try {
      await Future.wait<void>(
        plan.hrefs.map(
          (href) => _limiter.run(() async {
            _requireOpen();
            final key = await _acquire(
              artifact: artifact,
              reference: declarations[href]!,
              plan: plan,
              budget: budget,
              readResource: readResource,
            );
            acquired[href] = key;
          }),
        ),
      );
      _requireOpen();
      return RitoArtifactImageLease._(
        owner: this,
        sessionId: artifact.sessionId,
        artifactId: artifact.artifactId,
        images: Map<String, _CacheKey>.unmodifiable(acquired),
      );
    } on Object catch (error, stackTrace) {
      Object? rollbackError;
      for (final key in acquired.values) {
        try {
          _release(key);
        } on Object catch (cleanupError) {
          rollbackError ??= cleanupError;
        }
      }
      if (rollbackError != null) {
        Error.throwWithStackTrace(
          _ImagePrepareRollbackFailure(error, rollbackError),
          stackTrace,
        );
      }
      Error.throwWithStackTrace(error, stackTrace);
    }
  }

  Future<_CacheKey> _acquire({
    required RitoArtifact artifact,
    required RitoResourceRef reference,
    required _ImageTargetPlan plan,
    required _LeaseBudget budget,
    required RitoArtifactImageResourceReader readResource,
  }) async {
    final sourceKey = (sessionId: artifact.sessionId, href: reference.href);
    while (true) {
      _requireOpen();
      final known = _knownEntry(sourceKey);
      if (known != null) {
        final target = plan.targetFor(
          href: reference.href,
          sourceWidth: known.sourceWidth,
          sourceHeight: known.sourceHeight,
          bucketSize: targetBucketSize,
        );
        final key = _cacheKey(sourceKey, target);
        final existing = _entries[key];
        if (existing != null) {
          budget.reserveTarget(target.pixels, reference.href);
          existing.references += 1;
          return key;
        }
      }
      final pending = _loads[sourceKey];
      if (pending != null) {
        await pending;
        continue;
      }
      final operation = _load(
        artifact: artifact,
        reference: reference,
        plan: plan,
        budget: budget,
        readResource: readResource,
        expectedSource: known,
      );
      _loads[sourceKey] = operation;
      try {
        final entry = await operation;
        _requireOpen();
        entry.references += 1;
        return entry.key;
      } finally {
        if (identical(_loads[sourceKey], operation)) {
          unawaited(_loads.remove(sourceKey));
        }
      }
    }
  }

  Future<_ImageEntry> _load({
    required RitoArtifact artifact,
    required RitoResourceRef reference,
    required _ImageTargetPlan plan,
    required _LeaseBudget budget,
    required RitoArtifactImageResourceReader readResource,
    required _ImageEntry? expectedSource,
  }) async {
    final resource = await Future<RitoResource>.sync(
      () => readResource(reference),
    );
    _requireOpen();
    _validateResourceIdentity(artifact, reference, resource);
    budget.reserveEncoded(resource.bytes.length, reference.href);
    RitoImageDecodeSource? source;
    ui.Image? decoded;
    try {
      source = await _decoder.open(
        encodedBytes: resource.bytes,
        mediaType: resource.mediaType,
      );
      _requireOpen();
      _validateSource(resource, source, expectedSource);
      final target = plan.targetFor(
        href: reference.href,
        sourceWidth: source.width,
        sourceHeight: source.height,
        bucketSize: targetBucketSize,
      );
      budget.reserveTarget(target.pixels, reference.href);
      decoded = await source.decode(
        targetWidth: target.width,
        targetHeight: target.height,
      );
      try {
        _validateDecoded(decoded, source, target, reference.href);
      } on FormatException {
        // One image whose codec rounding disagrees with the plan must
        // not take down the whole artifact. Fall back to a full-size
        // decode held to the source dimensions; only an image that
        // cannot even reproduce itself still fails.
        decoded.dispose();
        decoded = null;
        final fallback = _ImageDecodeDimensions(
          width: source.width,
          height: source.height,
        );
        budget.reserveTarget(fallback.pixels - target.pixels, reference.href);
        decoded = await source.decode(
          targetWidth: fallback.width,
          targetHeight: fallback.height,
        );
        _validateDecoded(decoded, source, fallback, reference.href);
      }
      final sourceWidth = source.width;
      final sourceHeight = source.height;
      try {
        source.dispose();
      } finally {
        source = null;
      }
      _requireOpen();
      final key = _cacheKey((
        sessionId: artifact.sessionId,
        href: reference.href,
      ), target);
      final entry = _ImageEntry(
        key: key,
        image: decoded,
        sourceWidth: sourceWidth,
        sourceHeight: sourceHeight,
      );
      _entries[key] = entry;
      decoded = null;
      return entry;
    } finally {
      decoded?.dispose();
      source?.dispose();
    }
  }

  ui.Image _resolve(_CacheKey key) {
    _requireOpen();
    final entry = _entries[key];
    if (entry == null || entry.references <= 0) {
      throw StateError('Image lease no longer owns ${key.href}.');
    }
    return entry.image;
  }

  void _release(_CacheKey key) {
    final entry = _entries[key];
    if (entry == null || entry.references <= 0) {
      return;
    }
    entry.references -= 1;
    if (entry.references == 0 && identical(_entries[key], entry)) {
      _entries.remove(key);
      entry.image.dispose();
    }
  }

  void _requireOpen() {
    if (_disposed) {
      throw StateError('Rito artifact image cache has been disposed.');
    }
  }

  /// Invalidates all leases and disposes every decoded image, even if one
  /// disposal reports a failure. Calling this method again is harmless.
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _limiter.dispose();
    final entries = _entries.values.toList(growable: false);
    _entries.clear();
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final entry in entries) {
      try {
        entry.image.dispose();
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
