import 'dart:async';
import 'dart:typed_data';

import 'font/artifact_font_cache.dart';
import 'image/artifact_image_cache.dart';
import 'native/gateway.dart';
import 'protocol/artifact_models.dart';
import 'protocol/background_models.dart';
import 'protocol/foreground_models.dart';
import 'protocol/publication_models.dart';
import 'protocol/request_models.dart';

typedef RitoArtifactResourceReader =
    Future<RitoResource> Function(RitoResourceRef reference);

/// Optional host hook for preparing artifact resources such as decoded images.
///
/// Rito prepares declared fonts by default and images when an image cache is
/// configured on session open. Other resources are prepared only when the host
/// supplies this hook. The callback enforces artifact ownership and resource
/// declaration checks before crossing the gateway.
typedef RitoArtifactResourcePreparer =
    Future<void> Function({
      required RitoArtifact artifact,
      required RitoArtifactResourceReader readResource,
    });

/// One host-owned background result whose optional candidate has completed
/// resource and font preparation but has not been made visible.
final class RitoPreparedBackgroundAdvance {
  RitoPreparedBackgroundAdvance._({required this.advance, this.artifact});

  final RitoBackgroundAdvance advance;
  final RitoPreparedArtifact? artifact;
  bool _consumed = false;
}

final class RitoReaderSession {
  static const int _maxRequestId = 0x7fffffffffffffff;

  RitoReaderSession._({
    required this.gateway,
    required RitoArtifact firstArtifact,
    required RitoArtifactFontCache fontCache,
    required RitoArtifactImageCache? imageCache,
    required double imagePixelRatio,
    required RitoArtifactResourcePreparer? resourcePreparer,
  }) : _sessionId = firstArtifact.sessionId,
       _latestRequestId = firstArtifact.requestId,
       _fontCache = fontCache,
       _imageCache = imageCache,
       _imagePixelRatio = imagePixelRatio,
       _resourcePreparer = resourcePreparer,
       _liveArtifacts = <int>{firstArtifact.artifactId};

  static Future<RitoReaderSession> open({
    required RitoReaderGateway gateway,
    required Uint8List publicationBytes,
    required RitoArtifactRequest request,
    RitoArtifactFontCache? fontCache,
    RitoArtifactImageCache? imageCache,
    double imagePixelRatio = 1,
    RitoArtifactResourcePreparer? resourcePreparer,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) async {
    if (!imagePixelRatio.isFinite || imagePixelRatio <= 0) {
      throw ArgumentError.value(
        imagePixelRatio,
        'imagePixelRatio',
        'must be positive',
      );
    }
    // Register pinned faces under their engine aliases before the first
    // artifact can paint: every run's family stack rides these aliases
    // ahead of the generic tail, so paint resolves to the same bytes
    // layout measures with.
    if (pinnedFontPolicy != null) {
      await (fontCache ?? RitoArtifactFontCache.shared).registerPinnedFaces(
        pinnedFontPolicy,
      );
    }
    final artifact = await gateway.open(
      publicationBytes: publicationBytes,
      request: request,
      pinnedFontPolicy: pinnedFontPolicy,
    );
    // Marker capabilities are unrelated to RitoReaderGateway, so an `is`
    // check cannot promote; the pattern binds the capable view instead.
    final resumedIdentity =
        artifact.requestId > request.requestId &&
        switch (gateway) {
          final RitoResumableExactSeekGateway exactGateway =>
            exactGateway.acceptsResumedExactSeekArtifact(
              request: request,
              artifact: artifact,
            ),
          _ => false,
        };
    if (artifact.sessionId != request.sessionId ||
        (artifact.requestId != request.requestId && !resumedIdentity)) {
      await gateway.dispose(sessionId: request.sessionId);
      throw StateError('Native artifact identity does not match its request.');
    }
    final session = RitoReaderSession._(
      gateway: gateway,
      firstArtifact: artifact,
      fontCache: fontCache ?? RitoArtifactFontCache.shared,
      imageCache: imageCache,
      imagePixelRatio: imagePixelRatio,
      resourcePreparer: resourcePreparer,
    );
    try {
      final prepared = await session._prepareInitialCandidate(artifact);
      session.firstArtifact = prepared;
      return session;
    } on Object {
      await session.dispose();
      rethrow;
    }
  }

  final RitoReaderGateway gateway;
  final int _sessionId;
  int _latestRequestId;
  int? _visibleArtifactId;
  int? _visibleRequestId;
  final RitoArtifactFontCache _fontCache;
  final RitoArtifactImageCache? _imageCache;
  final double _imagePixelRatio;
  final RitoArtifactResourcePreparer? _resourcePreparer;
  final Set<int> _liveArtifacts;
  final Map<int, RitoArtifactImageLease> _imageLeases =
      <int, RitoArtifactImageLease>{};
  // Peeked neighbors keyed by (source artifact, direction). Records are
  // forgotten — never released — on staleness; the artifacts themselves
  // stay owned by the caller.
  final Map<({int fromArtifactId, String direction}), RitoPreparedArtifact>
  _peeked = <({int fromArtifactId, String direction}), RitoPreparedArtifact>{};
  late final RitoPreparedArtifact firstArtifact;
  _NavigationTicket? _activeNavigation;
  _NavigationTicket? _navigationTail;
  Future<void>? _disposeFuture;
  RitoNativeSessionInvalidatedException? _invalidation;
  Object? _terminalFailure;
  StackTrace? _terminalFailureStackTrace;
  bool _closing = false;
  bool _disposed = false;

  int get sessionId => _sessionId;

  /// Highest request ID consumed by this session, including cooperative
  /// continuation needed to publish an exact open, seek, or adjacent turn.
  int get latestRequestId => _latestRequestId;

  /// Native artifact currently committed as publication-visible.
  int get visibleArtifactId {
    final visible = _visibleArtifactId;
    if (visible == null) {
      throw StateError('Rito reader has no adopted visible artifact.');
    }
    return visible;
  }

  /// The request ID callers should use for the next seek, reflow, or turn.
  int get nextRequestId {
    if (_latestRequestId >= _maxRequestId) {
      throw StateError('Rito reader request ID space is exhausted.');
    }
    return _latestRequestId + 1;
  }

  bool get isDisposed => _closing;

  Future<RitoPublication> readPublication() async {
    _requireOpen();
    late final RitoPublication publication;
    try {
      publication = await gateway.readPublication(sessionId: sessionId);
    } on RitoNativeSessionInvalidatedException catch (error, stackTrace) {
      return _failClosedAfterCleanupFailure(
        requestId: error.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
    _requireOpen();
    if (publication.sessionId != sessionId) {
      return _failClosedAfterOwnershipFailure(
        requestId: _latestRequestId,
        failure: StateError(
          'Native publication identity does not match this session.',
        ),
        failureStackTrace: StackTrace.current,
      );
    }
    return publication;
  }

  /// Runs one host-scheduled publication-layout quantum.
  ///
  /// Any returned artifact has completed font preparation and the configured
  /// resource-preparer hook. It is owned by this session, but remains invisible
  /// until [adoptBackground] succeeds. Call [releaseArtifact] if the candidate
  /// is no longer wanted.
  Future<RitoPreparedBackgroundAdvance> advanceBackground({
    required int maxTopLevelNodesPerQuantum,
  }) async {
    _requireOpen();
    _requireForegroundIdle('Background work');
    if (maxTopLevelNodesPerQuantum <= 0 ||
        maxTopLevelNodesPerQuantum > 0xffffffff) {
      throw ArgumentError.value(
        maxTopLevelNodesPerQuantum,
        'maxTopLevelNodesPerQuantum',
        'must be in 1..=0xffffffff',
      );
    }
    final expectedVisible = visibleArtifactId;
    late final RitoBackgroundAdvance advance;
    try {
      advance = await gateway.advanceBackground(
        request: RitoBackgroundRequest(
          sessionId: sessionId,
          expectedVisibleArtifactId: expectedVisible,
          maxTopLevelNodesPerQuantum: maxTopLevelNodesPerQuantum,
        ),
      );
    } on RitoNativeSessionInvalidatedException catch (error, stackTrace) {
      return _failClosedAfterCleanupFailure(
        requestId: error.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
    _requireOpen();
    final candidate = advance.artifact;
    if (candidate != null) {
      _liveArtifacts.add(candidate.artifactId);
    }
    if (_activeNavigation != null ||
        _visibleArtifactId != expectedVisible ||
        advance.replacesArtifactId != expectedVisible ||
        advance.intentRequestId != _visibleRequestId) {
      if (candidate != null) {
        await _discardFailedArtifact(candidate);
      }
      throw StateError(
        'Background result no longer matches the visible foreground intent.',
      );
    }
    if (candidate == null) {
      return RitoPreparedBackgroundAdvance._(advance: advance);
    }
    try {
      final prepared = await _prepareOwnedArtifact(candidate);
      if (_activeNavigation != null || _visibleArtifactId != expectedVisible) {
        await _discardFailedArtifact(candidate);
        throw StateError(
          'Foreground navigation superseded the background candidate.',
        );
      }
      return RitoPreparedBackgroundAdvance._(
        advance: advance,
        artifact: prepared,
      );
    } on Object {
      await _discardFailedArtifact(candidate);
      rethrow;
    }
  }

  /// Commits a prepared background candidate with a visible-artifact CAS.
  Future<RitoBackgroundHandoffAck> adoptBackground(
    RitoPreparedBackgroundAdvance preparedAdvance,
  ) async {
    _requireOpen();
    final candidate = preparedAdvance.artifact;
    if (candidate == null) {
      throw ArgumentError('Background advance has no candidate artifact.');
    }
    if (preparedAdvance._consumed) {
      throw StateError('Background candidate has already been consumed.');
    }
    final artifact = candidate.artifact;
    if (artifact.sessionId != sessionId ||
        !_liveArtifacts.contains(artifact.artifactId)) {
      throw ArgumentError('Background candidate is not live in this session.');
    }
    if (artifact.artifactId == _visibleArtifactId) {
      throw StateError('Background candidate is already visible.');
    }
    preparedAdvance._consumed = true;
    if (_activeNavigation != null) {
      await _discardFailedArtifact(artifact);
      throw StateError(
        'Background adoption must yield to pending foreground navigation.',
      );
    }
    final expectedVisible = visibleArtifactId;
    final advance = preparedAdvance.advance;
    if (advance.replacesArtifactId != expectedVisible ||
        advance.intentRequestId != _visibleRequestId) {
      await _discardFailedArtifact(artifact);
      throw StateError(
        'Background candidate no longer matches the visible intent.',
      );
    }
    late final RitoBackgroundHandoffAck ack;
    try {
      ack = await gateway.adoptBackground(
        handoff: RitoBackgroundHandoff(
          sessionId: sessionId,
          expectedVisibleArtifactId: expectedVisible,
          candidateArtifactId: artifact.artifactId,
        ),
      );
    } on Object catch (error, stackTrace) {
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      await _discardFailedArtifact(artifact);
      rethrow;
    }
    if (ack.intentRequestId != advance.intentRequestId ||
        ack.replacedArtifactId != expectedVisible ||
        ack.visibleArtifactId != artifact.artifactId) {
      return _failClosedAfterOwnershipFailure(
        requestId: advance.intentRequestId,
        failure: StateError(
          'Native background adoption acknowledgement is inconsistent.',
        ),
        failureStackTrace: StackTrace.current,
      );
    }
    _visibleArtifactId = artifact.artifactId;
    _visibleRequestId = ack.intentRequestId;
    _peeked.clear();
    return ack;
  }

  Future<RitoPreparedArtifact> requestArtifact(
    RitoArtifactRequest request,
  ) async {
    _requireOpen();
    if (request.sessionId != sessionId) {
      throw ArgumentError('Request belongs to another Rito session.');
    }
    final navigation = _beginNavigation(request.requestId);
    try {
      final artifact = await gateway.requestArtifact(request: request);
      final resumedIdentity = _acceptsResumedExactSeek(request, artifact);
      if (artifact.sessionId != sessionId ||
          (artifact.requestId != request.requestId && !resumedIdentity)) {
        await _releaseRejectedArtifact(artifact);
        throw StateError(
          'Native artifact identity does not match its request.',
        );
      }
      _recordConsumedRequestId(artifact.requestId);
      return await _acceptAndPrepareNavigation(artifact, navigation);
    } on Object catch (error, stackTrace) {
      _syncConsumedExactSeekRequestId(request);
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      _throwTerminalFailureIfPresent();
      rethrow;
    } finally {
      _finishNavigation(navigation);
    }
  }

  /// Turns from an already-published artifact without re-seeking or rebuilding
  /// the current revision through `RITOREQ1`.
  ///
  /// The source remains live so callers can animate both artifacts. Release it
  /// explicitly only after the page-turn animation no longer paints it.
  /// Publishes the neighboring page as a fully prepared read-only
  /// artifact without changing the visible state — the peek/turn
  /// counterpart to [turn].
  ///
  /// The engine paginates toward the neighbor within [work]'s budget —
  /// in-chapter, across window rollovers, and across chapter
  /// boundaries alike — so peeks normally succeed even under lazy
  /// pagination. Returns null when the neighbor is still out of reach
  /// (the book's terminal boundary, or the budget ran out; the UI falls
  /// back to its
  /// fade-in path). A returned artifact is live, has fonts and images
  /// prepared, counts against the session's live-artifact budget, and
  /// must be freed with [releaseArtifact]. A later [turn] in the same
  /// direction from the same page commits the peeked artifact directly
  /// (zero layout, pure visible swap).
  Future<RitoPreparedArtifact?> peek({
    required RitoPreparedArtifact from,
    required int requestId,
    required RitoAdjacentDirection direction,
    required RitoWorkBudget work,
  }) async {
    _requireOpen();
    if (from.sessionId != sessionId) {
      throw ArgumentError('Peek source belongs to another Rito session.');
    }
    if (!_liveArtifacts.contains(from.artifactId)) {
      throw ArgumentError('Peek source artifact is not live.');
    }
    final artifact = await gateway.peekAdjacent(
      request: RitoAdjacentRequest(
        sessionId: sessionId,
        requestId: requestId,
        fromArtifactId: from.artifactId,
        direction: direction,
        work: work,
      ),
    );
    _recordConsumedRequestId(requestId);
    if (artifact == null) {
      return null;
    }
    _liveArtifacts.add(artifact.artifactId);
    late final RitoPreparedArtifact prepared;
    try {
      prepared = await _prepareOwnedArtifact(artifact);
    } on Object {
      await _discardFailedArtifact(artifact);
      rethrow;
    }
    _peeked[(fromArtifactId: from.artifactId, direction: direction.name)] =
        prepared;
    return prepared;
  }

  Future<RitoPreparedArtifact> turn({
    required RitoPreparedArtifact from,
    required int requestId,
    required RitoAdjacentDirection direction,
    required RitoWorkBudget work,
  }) async {
    if (from.sessionId != sessionId) {
      throw ArgumentError('Adjacent source belongs to another Rito session.');
    }
    // The cache probe is synchronous so a miss enters the ordinary
    // navigation without yielding the event loop (background work must
    // not slip in between turn and its navigation ticket).
    if (_peeked.containsKey((
      fromArtifactId: from.artifactId,
      direction: direction.name,
    ))) {
      final fast = await _commitPeekedIfCurrent(from, direction);
      if (fast != null) {
        return fast;
      }
    }
    return requestAdjacent(
      RitoAdjacentRequest(
        sessionId: sessionId,
        requestId: requestId,
        fromArtifactId: from.artifactId,
        direction: direction,
        work: work,
      ),
    );
  }

  /// Peek → turn fast path: when the target page was already peeked
  /// from this source, commit it with a pure visible-artifact swap and
  /// zero layout work. On any staleness the peek record is dropped and
  /// the caller falls back to the ordinary turn.
  Future<RitoPreparedArtifact?> _commitPeekedIfCurrent(
    RitoPreparedArtifact from,
    RitoAdjacentDirection direction,
  ) async {
    final key = (fromArtifactId: from.artifactId, direction: direction.name);
    final peeked = _peeked[key];
    if (peeked == null) {
      return null;
    }
    if (!_liveArtifacts.contains(peeked.artifactId) ||
        _visibleArtifactId != from.artifactId ||
        _activeNavigation != null) {
      _peeked.remove(key);
      return null;
    }
    _requireOpen();
    try {
      final ack = await gateway.commitPeeked(
        handoff: RitoForegroundHandoff(
          sessionId: sessionId,
          expectedVisibleArtifactId: from.artifactId,
          candidateArtifactId: peeked.artifactId,
        ),
        intentRequestId: peeked.requestId,
      );
      _visibleArtifactId = ack.visibleArtifactId;
      _visibleRequestId = ack.intentRequestId;
      _peeked.clear();
      return peeked;
    } on RitoNativeSessionInvalidatedException {
      rethrow;
    } on Object {
      // Stale CAS or any other rejection: forget the record and let the
      // ordinary turn resolve the navigation.
      _peeked.remove(key);
      return null;
    }
  }

  Future<RitoPreparedArtifact> requestAdjacent(
    RitoAdjacentRequest request,
  ) async {
    _requireOpen();
    if (request.sessionId != sessionId) {
      throw ArgumentError('Adjacent request belongs to another Rito session.');
    }
    if (!_liveArtifacts.contains(request.fromArtifactId)) {
      throw ArgumentError('Adjacent source artifact is not live.');
    }
    if (request.requestId <= 0 || request.requestId > _maxRequestId) {
      throw ArgumentError('Adjacent request ID must be non-zero.');
    }
    final navigation = _beginNavigation(request.requestId);
    try {
      final artifact = await gateway.requestAdjacent(request: request);
      final resumedIdentity = _acceptsResumedAdjacent(request, artifact);
      if (artifact.sessionId != sessionId ||
          (artifact.requestId != request.requestId && !resumedIdentity)) {
        await _releaseRejectedArtifact(artifact);
        throw StateError(
          'Native artifact identity does not match its request.',
        );
      }
      _recordConsumedRequestId(artifact.requestId);
      return await _acceptAndPrepareNavigation(artifact, navigation);
    } on Object catch (error, stackTrace) {
      _syncConsumedAdjacentRequestId(request);
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      _throwTerminalFailureIfPresent();
      rethrow;
    } finally {
      _finishNavigation(navigation);
    }
  }

  Future<RitoResource> readResource(
    RitoPreparedArtifact prepared,
    RitoResourceRef reference,
  ) {
    return _readOwnedResource(prepared.artifact, reference);
  }

  Future<RitoResource> _readOwnedResource(
    RitoArtifact artifact,
    RitoResourceRef reference,
  ) async {
    _requireOpen();
    if (artifact.sessionId != sessionId ||
        !_liveArtifacts.contains(artifact.artifactId)) {
      throw ArgumentError('Artifact is not live in this Rito session.');
    }
    if (!artifact.resources.any(
      (item) => item.kind == reference.kind && item.href == reference.href,
    )) {
      throw ArgumentError('Resource is not referenced by the artifact.');
    }
    late final RitoResource resource;
    try {
      resource = await gateway.readResource(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
        kind: reference.kind,
        href: reference.href,
      );
    } on RitoNativeSessionInvalidatedException catch (error, stackTrace) {
      return _failClosedAfterCleanupFailure(
        requestId: error.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
    _requireOpen();
    if (resource.artifactId != artifact.artifactId ||
        resource.kind != reference.kind ||
        resource.href != reference.href) {
      throw StateError('Resource ownership does not match its artifact.');
    }
    return resource;
  }

  Future<void> releaseArtifact(RitoPreparedArtifact prepared) async {
    _requireOpen();
    final artifact = prepared.artifact;
    if (artifact.sessionId != sessionId) {
      throw ArgumentError('Artifact belongs to another Rito session.');
    }
    if (artifact.artifactId == _visibleArtifactId) {
      throw StateError(
        'The visible artifact must remain live until a replacement is adopted.',
      );
    }
    if (!_liveArtifacts.remove(artifact.artifactId)) {
      return;
    }
    _peeked.removeWhere(
      (key, value) =>
          value.artifactId == artifact.artifactId ||
          key.fromArtifactId == artifact.artifactId,
    );
    try {
      await gateway.releaseArtifact(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
      );
    } on RitoNativeSessionInvalidatedException catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: error.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    } on Object {
      if (!_closing) {
        _liveArtifacts.add(artifact.artifactId);
      }
      rethrow;
    }
    try {
      _releaseImageLease(artifact.artifactId);
    } on Object catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: artifact.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
  }

  Future<void> dispose() {
    final existing = _disposeFuture;
    if (existing != null) {
      return existing;
    }
    _closing = true;
    _activeNavigation?.markSuperseded();
    _activeNavigation = null;
    final future = _runDispose();
    _disposeFuture = future;
    return future;
  }

  Future<void> _runDispose() async {
    Object? imageFailure;
    StackTrace? imageStackTrace;
    try {
      _releaseAllImageLeases();
    } on Object catch (error, stackTrace) {
      imageFailure = error;
      imageStackTrace = stackTrace;
    }
    Object? nativeFailure;
    StackTrace? nativeStackTrace;
    try {
      await gateway.dispose(sessionId: sessionId);
    } on Object catch (error, stackTrace) {
      nativeFailure = error;
      nativeStackTrace = stackTrace;
    }
    _disposed = true;
    _liveArtifacts.clear();
    _visibleArtifactId = null;
    _visibleRequestId = null;
    if (nativeFailure != null) {
      final failure = imageFailure == null
          ? nativeFailure
          : _NativeAndImageDisposeFailure(nativeFailure, imageFailure);
      _terminalFailure ??= failure;
      _terminalFailureStackTrace ??= nativeStackTrace;
      Error.throwWithStackTrace(failure, nativeStackTrace!);
    }
    if (imageFailure != null) {
      _terminalFailure ??= imageFailure;
      _terminalFailureStackTrace ??= imageStackTrace;
      Error.throwWithStackTrace(imageFailure, imageStackTrace!);
    }
  }

  void _releaseImageLease(int artifactId) {
    _imageLeases.remove(artifactId)?.release();
  }

  void _releaseAllImageLeases() {
    final leases = _imageLeases.values.toList(growable: false);
    _imageLeases.clear();
    Object? firstError;
    StackTrace? firstStackTrace;
    for (final lease in leases) {
      try {
        lease.release();
      } on Object catch (error, stackTrace) {
        firstError ??= error;
        firstStackTrace ??= stackTrace;
      }
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }

  void _requireOpen() {
    if (!_closing) {
      return;
    }
    _throwTerminalFailureIfPresent();
    if (_disposed) {
      throw StateError('Rito reader session is disposed.');
    }
    throw StateError('Rito reader session is closing.');
  }

  void _throwTerminalFailureIfPresent() {
    final failure = _terminalFailure;
    if (failure != null) {
      Error.throwWithStackTrace(
        failure,
        _terminalFailureStackTrace ?? StackTrace.current,
      );
    }
  }

  void _requireForegroundIdle(String operation) {
    if (_activeNavigation != null) {
      throw StateError('$operation must yield to foreground navigation.');
    }
  }

  Future<void> _releaseRejectedArtifact(RitoArtifact artifact) async {
    try {
      await gateway.releaseArtifact(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
      );
      _releaseImageLease(artifact.artifactId);
    } on Object catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: artifact.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
  }

  bool _acceptsResumedExactSeek(
    RitoArtifactRequest request,
    RitoArtifact artifact,
  ) {
    if (gateway case final RitoResumableExactSeekGateway exactGateway) {
      return artifact.requestId > request.requestId &&
          exactGateway.acceptsResumedExactSeekArtifact(
            request: request,
            artifact: artifact,
          );
    }
    return false;
  }

  void _syncConsumedExactSeekRequestId(RitoArtifactRequest request) {
    if (gateway case final RitoResumableExactSeekGateway exactGateway) {
      final consumed = exactGateway.latestRequestIdForExactSeek(
        request: request,
      );
      if (consumed != null && consumed <= _maxRequestId) {
        _recordConsumedRequestId(consumed);
      }
    }
  }

  bool _acceptsResumedAdjacent(
    RitoAdjacentRequest request,
    RitoArtifact artifact,
  ) {
    if (gateway case final RitoResumableAdjacentGateway adjacentGateway) {
      return artifact.requestId > request.requestId &&
          adjacentGateway.acceptsResumedAdjacentArtifact(
            request: request,
            artifact: artifact,
          );
    }
    return false;
  }

  void _syncConsumedAdjacentRequestId(RitoAdjacentRequest request) {
    if (gateway case final RitoResumableAdjacentGateway adjacentGateway) {
      final consumed = adjacentGateway.latestRequestIdForAdjacent(
        request: request,
      );
      if (consumed != null && consumed <= _maxRequestId) {
        _recordConsumedRequestId(consumed);
      }
    }
  }

  void _recordConsumedRequestId(int requestId) {
    if (requestId > _latestRequestId) {
      _latestRequestId = requestId;
    }
  }

  _NavigationTicket _beginNavigation(int requestId) {
    if (requestId <= _latestRequestId || requestId > _maxRequestId) {
      throw ArgumentError(
        'Request ID must be greater than $_latestRequestId and remain within '
        'the positive signed 64-bit range.',
      );
    }
    _latestRequestId = requestId;
    _activeNavigation?.markSuperseded(replacementRequestId: requestId);
    final navigation = _NavigationTicket(
      sessionId: sessionId,
      requestId: requestId,
      priorSettlement: _navigationTail?.settlement ?? Future<void>.value(),
    );
    _activeNavigation = navigation;
    _navigationTail = navigation;
    unawaited(
      navigation.settlement.whenComplete(() {
        if (identical(_navigationTail, navigation)) {
          _navigationTail = null;
        }
      }),
    );
    return navigation;
  }

  void _finishNavigation(_NavigationTicket navigation) {
    if (identical(_activeNavigation, navigation)) {
      _activeNavigation = null;
    }
    navigation.complete();
  }

  Future<RitoPreparedArtifact> _acceptAndPrepareNavigation(
    RitoArtifact artifact,
    _NavigationTicket navigation,
  ) async {
    if (navigation.isSuperseded) {
      await _releaseSupersededArtifact(artifact);
      _throwTerminalFailureIfPresent();
      throw navigation.exception;
    }
    _requireOpen();
    _liveArtifacts.add(artifact.artifactId);
    late final RitoPreparedArtifact prepared;
    try {
      prepared = await _prepareOwnedArtifact(artifact);
    } on Object {
      if (navigation.isSuperseded) {
        await _discardSupersededArtifact(artifact);
      } else {
        await _discardFailedArtifact(artifact);
      }
      _throwTerminalFailureIfPresent();
      rethrow;
    }
    await navigation.priorSettlement;
    _requireOpen();
    if (navigation.isSuperseded) {
      await _discardSupersededArtifact(artifact);
      throw navigation.exception;
    }
    final expectedVisible = _visibleArtifactId;
    if (expectedVisible == null) {
      return _failClosedAfterOwnershipFailure(
        requestId: artifact.requestId,
        failure: StateError('Reader session lost its visible artifact.'),
        failureStackTrace: StackTrace.current,
      );
    }
    late final RitoForegroundHandoffAck ack;
    try {
      ack = await gateway.adoptForeground(
        handoff: RitoForegroundHandoff(
          sessionId: sessionId,
          expectedVisibleArtifactId: expectedVisible,
          candidateArtifactId: artifact.artifactId,
        ),
      );
    } on Object catch (error, stackTrace) {
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      await _discardFailedArtifact(artifact);
      _throwTerminalFailureIfPresent();
      rethrow;
    }
    if (!_foregroundAckMatches(
      ack,
      artifact: artifact,
      expectedVisibleArtifactId: expectedVisible,
    )) {
      return _failClosedAfterOwnershipFailure(
        requestId: artifact.requestId,
        failure: StateError(
          'Native foreground adoption acknowledgement is inconsistent.',
        ),
        failureStackTrace: StackTrace.current,
      );
    }
    _visibleArtifactId = artifact.artifactId;
    _visibleRequestId = ack.intentRequestId;
    _peeked.clear();
    return prepared;
  }

  Future<RitoPreparedArtifact> _prepareInitialCandidate(
    RitoArtifact artifact,
  ) async {
    late final RitoPreparedArtifact prepared;
    try {
      prepared = await _prepareOwnedArtifact(artifact);
    } on Object catch (error, stackTrace) {
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      await _discardFailedArtifact(artifact);
      rethrow;
    }
    late final RitoForegroundHandoffAck ack;
    try {
      ack = await gateway.adoptForeground(
        handoff: RitoForegroundHandoff(
          sessionId: sessionId,
          candidateArtifactId: artifact.artifactId,
        ),
      );
    } on Object catch (error, stackTrace) {
      if (error is RitoNativeSessionInvalidatedException) {
        return _failClosedAfterCleanupFailure(
          requestId: error.requestId,
          cleanupError: error,
          cleanupStackTrace: stackTrace,
        );
      }
      await _discardFailedArtifact(artifact);
      rethrow;
    }
    if (!_foregroundAckMatches(
      ack,
      artifact: artifact,
      expectedVisibleArtifactId: null,
    )) {
      return _failClosedAfterOwnershipFailure(
        requestId: artifact.requestId,
        failure: StateError(
          'Native initial foreground acknowledgement is inconsistent.',
        ),
        failureStackTrace: StackTrace.current,
      );
    }
    _visibleArtifactId = artifact.artifactId;
    _visibleRequestId = ack.intentRequestId;
    _peeked.clear();
    return prepared;
  }

  bool _foregroundAckMatches(
    RitoForegroundHandoffAck ack, {
    required RitoArtifact artifact,
    required int? expectedVisibleArtifactId,
  }) {
    return ack.intentRequestId == artifact.requestId &&
        ack.replacedArtifactId == expectedVisibleArtifactId &&
        ack.visibleArtifactId == artifact.artifactId;
  }

  Future<RitoPreparedArtifact> _prepareOwnedArtifact(
    RitoArtifact artifact,
  ) async {
    var prepared = await _fontCache.prepare(
      artifact: artifact,
      readResource: (reference) => _readOwnedResource(artifact, reference),
    );
    RitoArtifactImageLease? imageLease;
    try {
      final imageCache = _imageCache;
      if (imageCache != null) {
        imageLease = await imageCache.prepare(
          artifact: artifact,
          readResource: (reference) => _readOwnedResource(artifact, reference),
          pixelRatio: _imagePixelRatio,
        );
        prepared = RitoPreparedArtifact.withImageLease(
          fontPrepared: prepared,
          imageLease: imageLease,
        );
      }
      final resourcePreparer = _resourcePreparer;
      if (resourcePreparer != null) {
        await resourcePreparer(
          artifact: artifact,
          readResource: (reference) => _readOwnedResource(artifact, reference),
        );
      }
      _requireOpen();
      if (imageLease != null) {
        final previous = _imageLeases[artifact.artifactId];
        if (previous != null) {
          throw StateError('Artifact already owns an image lease.');
        }
        _imageLeases[artifact.artifactId] = imageLease;
      }
      return prepared;
    } on Object {
      imageLease?.release();
      rethrow;
    }
  }

  Future<void> _discardFailedArtifact(RitoArtifact artifact) async {
    if (!_liveArtifacts.remove(artifact.artifactId) || _closing) {
      return;
    }
    try {
      await gateway.releaseArtifact(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
      );
      _releaseImageLease(artifact.artifactId);
    } on Object catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: artifact.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
  }

  Future<void> _releaseSupersededArtifact(RitoArtifact artifact) async {
    if (_closing) {
      return;
    }
    try {
      await gateway.releaseArtifact(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
      );
    } on Object catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: artifact.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
  }

  Future<void> _discardSupersededArtifact(RitoArtifact artifact) async {
    if (!_liveArtifacts.remove(artifact.artifactId) || _closing) {
      return;
    }
    try {
      await gateway.releaseArtifact(
        sessionId: sessionId,
        artifactId: artifact.artifactId,
      );
      _releaseImageLease(artifact.artifactId);
    } on Object catch (error, stackTrace) {
      await _failClosedAfterCleanupFailure(
        requestId: artifact.requestId,
        cleanupError: error,
        cleanupStackTrace: stackTrace,
      );
    }
  }

  Future<Never> _failClosedAfterCleanupFailure({
    required int requestId,
    required Object cleanupError,
    required StackTrace cleanupStackTrace,
  }) async {
    var invalidation = _invalidation;
    if (invalidation == null) {
      invalidation = cleanupError is RitoNativeSessionInvalidatedException
          ? cleanupError
          : RitoNativeSessionInvalidatedException(
              sessionId: sessionId,
              requestId: requestId,
              cleanupError: cleanupError,
            );
      _invalidation = invalidation;
      _terminalFailure = invalidation;
      _terminalFailureStackTrace = cleanupStackTrace;
    }
    try {
      await dispose();
    } on Object catch (disposeError) {
      final currentCleanupError = invalidation.cleanupError;
      if (currentCleanupError is! _CleanupAndDisposeFailure) {
        invalidation = RitoNativeSessionInvalidatedException(
          sessionId: invalidation.sessionId,
          requestId: invalidation.requestId,
          cleanupError: _CleanupAndDisposeFailure(
            cleanupError: currentCleanupError,
            disposeError: disposeError,
          ),
        );
        _invalidation = invalidation;
        _terminalFailure = invalidation;
        _terminalFailureStackTrace = cleanupStackTrace;
      }
    }
    Error.throwWithStackTrace(invalidation, cleanupStackTrace);
  }

  Future<Never> _failClosedAfterOwnershipFailure({
    required int requestId,
    required Object failure,
    required StackTrace failureStackTrace,
  }) {
    return _failClosedAfterCleanupFailure(
      requestId: requestId,
      cleanupError: failure,
      cleanupStackTrace: failureStackTrace,
    );
  }
}

final class _NativeAndImageDisposeFailure implements Exception {
  const _NativeAndImageDisposeFailure(this.nativeFailure, this.imageFailure);

  final Object nativeFailure;
  final Object imageFailure;

  @override
  String toString() {
    return 'Native session disposal failed ($nativeFailure), and image '
        'cleanup also failed ($imageFailure).';
  }
}

final class _CleanupAndDisposeFailure implements Exception {
  const _CleanupAndDisposeFailure({
    required this.cleanupError,
    required this.disposeError,
  });

  final Object cleanupError;
  final Object disposeError;

  @override
  String toString() {
    return 'Artifact cleanup failed ($cleanupError), then native session '
        'disposal failed ($disposeError).';
  }
}

final class _NavigationTicket {
  _NavigationTicket({
    required this.sessionId,
    required this.requestId,
    required this.priorSettlement,
  }) {
    settlement = priorSettlement.then((_) => _completion.future);
  }

  final int sessionId;
  final int requestId;
  final Future<void> priorSettlement;
  final Completer<void> _completion = Completer<void>();
  late final Future<void> settlement;
  bool isSuperseded = false;
  int? replacementRequestId;

  RitoNavigationSupersededException get exception {
    return RitoNavigationSupersededException(
      sessionId: sessionId,
      requestId: requestId,
      replacementRequestId: replacementRequestId,
    );
  }

  void markSuperseded({int? replacementRequestId}) {
    isSuperseded = true;
    this.replacementRequestId = replacementRequestId;
  }

  void complete() {
    if (!_completion.isCompleted) {
      _completion.complete();
    }
  }
}
