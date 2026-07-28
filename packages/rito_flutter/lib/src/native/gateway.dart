import 'dart:async';
import 'dart:ffi';
import 'dart:isolate';
import 'dart:typed_data';

import '../protocol/artifact_decoder.dart';
import '../protocol/artifact_models.dart';
import '../protocol/background_decoder.dart';
import '../protocol/background_encoder.dart';
import '../protocol/background_models.dart';
import '../protocol/foreground_decoder.dart';
import '../protocol/foreground_encoder.dart';
import '../protocol/foreground_models.dart';
import '../protocol/publication_decoder.dart';
import '../protocol/publication_models.dart';
import '../protocol/request_encoder.dart';
import '../protocol/request_models.dart';
import '../protocol/resource_decoder.dart';
import 'bindings.dart';
import 'gateway_queue.dart';
import 'owned_byte_transfer.dart';
import 'pending_adjacent.dart';
import 'pending_open.dart';
import 'pinned_font_policy.dart';
import 'session_lane.dart';
import 'worker_lifecycle.dart';

export 'session_lane.dart'
    show
        RitoNativeSessionInvalidatedException,
        RitoNavigationSupersededException;
export 'pending_open.dart'
    show
        RitoPendingExactSeekDriver,
        RitoPendingExactSeekLimitException,
        ritoPendingExactSeekContinuationCapV1;
export 'pending_adjacent.dart'
    show
        RitoPendingAdjacentDriver,
        RitoPendingAdjacentLimitException,
        ritoPendingAdjacentContinuationCapV1;
export '../protocol/background_models.dart';
export '../protocol/foreground_models.dart';
export '../protocol/publication_models.dart';
export 'pinned_font_policy.dart'
    show RitoPinnedFontFace, RitoPinnedFontGenericRole, RitoPinnedFontPolicy;
export 'worker_lifecycle.dart' show RitoNativeWorkerTerminatedException;

part 'worker.dart';

abstract interface class RitoReaderGateway {
  Future<RitoArtifact> open({
    required Uint8List publicationBytes,
    required RitoArtifactRequest request,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  });

  Future<RitoArtifact> requestArtifact({required RitoArtifactRequest request});

  Future<RitoArtifact> requestAdjacent({required RitoAdjacentRequest request});

  Future<RitoPublication> readPublication({required int sessionId});

  Future<RitoForegroundHandoffAck> adoptForeground({
    required RitoForegroundHandoff handoff,
  });

  Future<RitoBackgroundAdvance> advanceBackground({
    required RitoBackgroundRequest request,
  });

  Future<RitoBackgroundHandoffAck> adoptBackground({
    required RitoBackgroundHandoff handoff,
  });

  Future<RitoResource> readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  });

  Future<void> releaseArtifact({
    required int sessionId,
    required int artifactId,
  });

  Future<void> dispose({required int sessionId});
}

/// Marker contract for gateways that may consume additional native request IDs
/// while cooperatively resolving an exact open or seek.
abstract interface class RitoResumableExactSeekGateway {
  bool acceptsResumedExactSeekArtifact({
    required RitoArtifactRequest request,
    required RitoArtifact artifact,
  });

  int? latestRequestIdForExactSeek({required RitoArtifactRequest request});
}

/// Marker contract for gateways that consume strictly newer native request IDs
/// while cooperatively resolving one retained adjacent intent.
abstract interface class RitoResumableAdjacentGateway {
  bool acceptsResumedAdjacentArtifact({
    required RitoAdjacentRequest request,
    required RitoArtifact artifact,
  });

  int? latestRequestIdForAdjacent({required RitoAdjacentRequest request});
}

enum RitoDynamicLibraryKind { path, process, executable }

final class RitoDynamicLibrarySource {
  const RitoDynamicLibrarySource.path(this.path)
    : kind = RitoDynamicLibraryKind.path;

  const RitoDynamicLibrarySource.process()
    : kind = RitoDynamicLibraryKind.process,
      path = null;

  const RitoDynamicLibrarySource.executable()
    : kind = RitoDynamicLibraryKind.executable,
      path = null;

  final RitoDynamicLibraryKind kind;
  final String? path;

  DynamicLibrary open() {
    return switch (kind) {
      RitoDynamicLibraryKind.path => DynamicLibrary.open(path!),
      RitoDynamicLibraryKind.process => DynamicLibrary.process(),
      RitoDynamicLibraryKind.executable => DynamicLibrary.executable(),
    };
  }
}

/// Runs EPUB parsing, CSS, layout, resource access, release and disposal away
/// from Flutter's UI isolate. Large typed-wire payloads use Dart's transferable
/// isolate transport and are decoded only after the receiver materializes them.
/// This avoids an isolate-message copy; it is not an end-to-end zero-copy claim
/// across caller buffers, FFI allocation, and Rust ownership.
final class RitoIsolateGateway
    implements
        RitoReaderGateway,
        RitoResumableExactSeekGateway,
        RitoResumableAdjacentGateway {
  RitoIsolateGateway({this.diagnosticLibrary}) {
    _worker = _RitoWorkerClient.start(diagnosticLibrary);
  }

  /// Optional explicit library source for tests and embedding diagnostics.
  /// Normal Flutter applications leave this null and use the bundled asset.
  final RitoDynamicLibrarySource? diagnosticLibrary;
  final RitoArtifactDecoder _artifactDecoder = const RitoArtifactDecoder();
  final RitoPublicationDecoder _publicationDecoder =
      const RitoPublicationDecoder();
  final RitoForegroundEncoder _foregroundEncoder =
      const RitoForegroundEncoder();
  final RitoForegroundDecoder _foregroundDecoder =
      const RitoForegroundDecoder();
  final RitoBackgroundEncoder _backgroundEncoder =
      const RitoBackgroundEncoder();
  final RitoBackgroundDecoder _backgroundDecoder =
      const RitoBackgroundDecoder();
  final RitoResourceDecoder _resourceDecoder = const RitoResourceDecoder();
  final RitoRequestEncoder _requestEncoder = const RitoRequestEncoder();
  final RitoNativeGatewayQueue _queue = RitoNativeGatewayQueue();
  final RitoPendingExactSeekDriver _pendingExactSeek =
      const RitoPendingExactSeekDriver();
  final RitoPendingAdjacentDriver _pendingAdjacent =
      const RitoPendingAdjacentDriver();
  final Map<int, _GatewayIntent> _intents = <int, _GatewayIntent>{};
  final Map<int, RitoArtifact> _pendingForegroundCandidates =
      <int, RitoArtifact>{};
  final Map<int, RitoBackgroundAdvance> _pendingBackgroundCandidates =
      <int, RitoBackgroundAdvance>{};
  late final Future<_RitoWorkerClient> _worker;

  @override
  Future<RitoArtifact> open({
    required Uint8List publicationBytes,
    required RitoArtifactRequest request,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) async {
    _requestEncoder.encode(request);
    final intent = _claimExactSeekIntent(request.sessionId, request.requestId);
    final nativeRequest = _oneQuantumRequestWithId(request, intent.requestId);
    final requestBytes = _requestEncoder.encode(nativeRequest);
    final pinnedFontFaces = pinnedFontPolicy == null
        ? null
        : <_PinnedFontFaceTransfer>[
            for (final face in pinnedFontPolicy.faces)
              _PinnedFontFaceTransfer(
                bytes: RitoOwnedByteTransfer.take(face.bytes),
                sha256Hex: face.sha256Hex,
                genericRole: face.genericRole,
                language: face.language,
              ),
          ];
    return _runExactSeekIntent(
      intent: intent,
      request: nativeRequest,
      opening: true,
      initialOperation: () => _queue.open<RitoArtifact>(
        sessionId: request.sessionId,
        requestId: nativeRequest.requestId,
        nativeSessionMayExistOnError: _isExactSeekPending,
        onSupersededResult: _releaseSupersededArtifact,
        disposeAfterCleanupFailure: (_, _) =>
            _disposeNativeSession(request.sessionId),
        operation: () => _guardNativeSessionOperation<RitoArtifact>(
          sessionId: request.sessionId,
          requestId: nativeRequest.requestId,
          operation: () async {
            final worker = await _worker;
            final wireBytes = await worker.invokeWire(
              _OpenOperation(
                sessionId: request.sessionId,
                publicationBytes: RitoOwnedByteTransfer.take(publicationBytes),
                requestBytes: requestBytes,
                pinnedFontFaces: pinnedFontFaces,
              ),
            );
            return _decodeArtifact(
              wireBytes: wireBytes,
              sessionId: request.sessionId,
              requestId: nativeRequest.requestId,
            );
          },
        ),
      ),
    );
  }

  @override
  Future<RitoArtifact> requestArtifact({
    required RitoArtifactRequest request,
  }) async {
    _requestEncoder.encode(request);
    final intent = _claimExactSeekIntent(request.sessionId, request.requestId);
    final nativeRequest = _oneQuantumRequestWithId(request, intent.requestId);
    return _runExactSeekIntent(
      intent: intent,
      request: nativeRequest,
      opening: false,
      initialOperation: () => _requestArtifactOnce(nativeRequest),
    );
  }

  Future<RitoArtifact> _runExactSeekIntent({
    required _GatewayIntent intent,
    required RitoArtifactRequest request,
    required bool opening,
    required Future<RitoArtifact> Function() initialOperation,
  }) async {
    try {
      return await initialOperation();
    } on RitoNativeException catch (error, stackTrace) {
      if (!_isExactSeekPending(error)) {
        if (opening) {
          _forgetIntent(intent);
        }
        Error.throwWithStackTrace(error, stackTrace);
      }
      if (!_isCurrent(intent)) {
        throw _superseded(intent);
      }
      return _pendingExactSeek.resume(
        initialRequest: request,
        requestOneQuantum: (continuation) {
          intent.requestId = continuation.requestId;
          return _requestArtifactOnce(continuation);
        },
        yieldHostTurn: _yieldHostTurn,
        isCurrent: () => _isCurrent(intent),
        replacementRequestId: () => _replacementRequestId(intent),
        onTerminal: (error, _) =>
            _finishPendingExactSeek(intent, error, opening: opening),
      );
    } on Object {
      _forgetIntent(intent);
      rethrow;
    }
  }

  Future<RitoArtifact> _requestArtifactOnce(RitoArtifactRequest request) async {
    final requestBytes = _requestEncoder.encode(request);
    return _queue.navigate<RitoArtifact>(
      sessionId: request.sessionId,
      requestId: request.requestId,
      onSupersededResult: _releaseSupersededArtifact,
      disposeAfterCleanupFailure: (_, _) =>
          _disposeNativeSession(request.sessionId),
      operation: () => _guardNativeMutation<RitoArtifact>(
        sessionId: request.sessionId,
        requestId: request.requestId,
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _RequestArtifactOperation(
              sessionId: request.sessionId,
              requestBytes: requestBytes,
            ),
          );
          return _decodeArtifact(
            wireBytes: wireBytes,
            sessionId: request.sessionId,
            requestId: request.requestId,
          );
        },
      ),
    );
  }

  @override
  Future<RitoArtifact> requestAdjacent({
    required RitoAdjacentRequest request,
  }) async {
    _requestEncoder.encodeAdjacent(request);
    final intent = _claimAdjacentIntent(request);
    final nativeRequest = oneQuantumAdjacentRequest(request, intent.requestId);
    return _runAdjacentIntent(intent: intent, request: nativeRequest);
  }

  Future<RitoArtifact> _runAdjacentIntent({
    required _GatewayIntent intent,
    required RitoAdjacentRequest request,
  }) async {
    try {
      return await _requestAdjacentOnce(request);
    } on RitoNativeException catch (error, stackTrace) {
      if (!_isAdjacentPending(error)) {
        Error.throwWithStackTrace(error, stackTrace);
      }
      if (!_isCurrent(intent)) {
        throw _superseded(intent);
      }
      return _pendingAdjacent.resume(
        initialRequest: request,
        requestOneQuantum: (continuation) {
          intent.requestId = continuation.requestId;
          return _requestAdjacentOnce(continuation);
        },
        yieldHostTurn: _yieldHostTurn,
        isCurrent: () => _isCurrent(intent),
        replacementRequestId: () => _replacementRequestId(intent),
        onTerminal: (error, _) => _finishPendingAdjacent(intent, error),
      );
    } on Object {
      _forgetIntent(intent);
      rethrow;
    }
  }

  Future<RitoArtifact> _requestAdjacentOnce(RitoAdjacentRequest request) async {
    final requestBytes = _requestEncoder.encodeAdjacent(request);
    return _queue.navigate<RitoArtifact>(
      sessionId: request.sessionId,
      requestId: request.requestId,
      onSupersededResult: _releaseSupersededArtifact,
      disposeAfterCleanupFailure: (_, _) =>
          _disposeNativeSession(request.sessionId),
      operation: () => _guardNativeMutation<RitoArtifact>(
        sessionId: request.sessionId,
        requestId: request.requestId,
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _RequestAdjacentOperation(
              sessionId: request.sessionId,
              requestBytes: requestBytes,
            ),
          );
          return _decodeArtifact(
            wireBytes: wireBytes,
            sessionId: request.sessionId,
            requestId: request.requestId,
          );
        },
      ),
    );
  }

  @override
  Future<RitoPublication> readPublication({required int sessionId}) {
    return _queue.ordered<RitoPublication>(
      sessionId: sessionId,
      operation: () => _guardNativeSessionOperation<RitoPublication>(
        sessionId: sessionId,
        requestId: _diagnosticRequestId(sessionId),
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _ReadPublicationOperation(sessionId),
          );
          return _decodeSessionWire<RitoPublication>(
            sessionId: sessionId,
            field: 'publication',
            wireBytes: wireBytes,
            decode: _publicationDecoder.decode,
            validate: (publication) => publication.sessionId == sessionId,
          );
        },
      ),
    );
  }

  @override
  Future<RitoForegroundHandoffAck> adoptForeground({
    required RitoForegroundHandoff handoff,
  }) {
    final candidate = _pendingForegroundCandidates[handoff.sessionId];
    if (candidate == null ||
        candidate.artifactId != handoff.candidateArtifactId) {
      return Future<RitoForegroundHandoffAck>.error(
        StateError('Foreground candidate is no longer current.'),
        StackTrace.current,
      );
    }
    final requestBytes = _foregroundEncoder.encodeHandoff(handoff);
    return _queue.ordered<RitoForegroundHandoffAck>(
      sessionId: handoff.sessionId,
      operation: () => _guardNativeMutation<RitoForegroundHandoffAck>(
        sessionId: handoff.sessionId,
        requestId: candidate.requestId,
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _AdoptForegroundOperation(
              sessionId: handoff.sessionId,
              requestBytes: requestBytes,
            ),
          );
          final ack = await _decodeSessionWire<RitoForegroundHandoffAck>(
            sessionId: handoff.sessionId,
            field: 'foreground handoff acknowledgement',
            wireBytes: wireBytes,
            decode: _foregroundDecoder.decodeHandoffAck,
            validate: (ack) =>
                ack.intentRequestId == candidate.requestId &&
                ack.replacedArtifactId == handoff.expectedVisibleArtifactId &&
                ack.visibleArtifactId == handoff.candidateArtifactId,
          );
          if (identical(
            _pendingForegroundCandidates[handoff.sessionId],
            candidate,
          )) {
            _pendingForegroundCandidates.remove(handoff.sessionId);
          }
          return ack;
        },
      ),
    );
  }

  @override
  Future<RitoBackgroundAdvance> advanceBackground({
    required RitoBackgroundRequest request,
  }) {
    final requestBytes = _backgroundEncoder.encodeRequest(request);
    return _queue.ordered<RitoBackgroundAdvance>(
      sessionId: request.sessionId,
      operation: () => _guardNativeMutation<RitoBackgroundAdvance>(
        sessionId: request.sessionId,
        requestId: _diagnosticRequestId(request.sessionId),
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _AdvanceBackgroundOperation(
              sessionId: request.sessionId,
              requestBytes: requestBytes,
            ),
          );
          final advance = await _decodeSessionWire<RitoBackgroundAdvance>(
            sessionId: request.sessionId,
            field: 'background advance',
            wireBytes: wireBytes,
            decode: _backgroundDecoder.decodeAdvance,
            validate: (advance) {
              final artifact = advance.artifact;
              return advance.replacesArtifactId ==
                      request.expectedVisibleArtifactId &&
                  (artifact == null ||
                      (artifact.sessionId == request.sessionId &&
                          artifact.requestId == advance.intentRequestId));
            },
          );
          if (advance.artifact != null) {
            _pendingBackgroundCandidates[request.sessionId] = advance;
          } else if (advance.state != RitoBackgroundState.candidatePending) {
            _pendingBackgroundCandidates.remove(request.sessionId);
          }
          return advance;
        },
      ),
    );
  }

  @override
  Future<RitoBackgroundHandoffAck> adoptBackground({
    required RitoBackgroundHandoff handoff,
  }) {
    if (_pendingForegroundCandidates.containsKey(handoff.sessionId)) {
      return Future<RitoBackgroundHandoffAck>.error(
        StateError(
          'Background adoption must wait for the foreground candidate.',
        ),
        StackTrace.current,
      );
    }
    final pending = _pendingBackgroundCandidates[handoff.sessionId];
    if (pending?.artifact?.artifactId != handoff.candidateArtifactId ||
        pending?.replacesArtifactId != handoff.expectedVisibleArtifactId) {
      return Future<RitoBackgroundHandoffAck>.error(
        StateError('Background candidate is no longer current.'),
        StackTrace.current,
      );
    }
    final currentPending = pending!;
    final requestBytes = _backgroundEncoder.encodeHandoff(handoff);
    return _queue.ordered<RitoBackgroundHandoffAck>(
      sessionId: handoff.sessionId,
      operation: () => _guardNativeMutation<RitoBackgroundHandoffAck>(
        sessionId: handoff.sessionId,
        requestId: currentPending.intentRequestId,
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _AdoptBackgroundOperation(
              sessionId: handoff.sessionId,
              requestBytes: requestBytes,
            ),
          );
          final ack = await _decodeSessionWire<RitoBackgroundHandoffAck>(
            sessionId: handoff.sessionId,
            field: 'background handoff acknowledgement',
            wireBytes: wireBytes,
            decode: _backgroundDecoder.decodeHandoffAck,
            validate: (ack) =>
                ack.intentRequestId == currentPending.intentRequestId &&
                ack.replacedArtifactId == handoff.expectedVisibleArtifactId &&
                ack.visibleArtifactId == handoff.candidateArtifactId,
          );
          if (identical(
            _pendingBackgroundCandidates[handoff.sessionId],
            currentPending,
          )) {
            _pendingBackgroundCandidates.remove(handoff.sessionId);
          }
          return ack;
        },
      ),
    );
  }

  @override
  Future<RitoResource> readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) async {
    return _queue.ordered<RitoResource>(
      sessionId: sessionId,
      operation: () => _guardNativeSessionOperation<RitoResource>(
        sessionId: sessionId,
        requestId: _diagnosticRequestId(sessionId),
        operation: () async {
          final worker = await _worker;
          final wireBytes = await worker.invokeWire(
            _ReadResourceOperation(
              sessionId: sessionId,
              artifactId: artifactId,
              kind: kind,
              href: href,
            ),
          );
          return _decodeSessionWire<RitoResource>(
            sessionId: sessionId,
            field: 'resource',
            wireBytes: wireBytes,
            decode: _resourceDecoder.decode,
            validate: (resource) =>
                resource.artifactId == artifactId &&
                resource.kind == kind &&
                resource.href == href,
          );
        },
      ),
    );
  }

  @override
  Future<void> releaseArtifact({
    required int sessionId,
    required int artifactId,
  }) async {
    await _queue.ordered<Object?>(
      sessionId: sessionId,
      operation: () => _guardNativeMutation<Object?>(
        sessionId: sessionId,
        requestId: _diagnosticRequestId(sessionId),
        operation: () async {
          final worker = await _worker;
          return worker.invoke<Object?>(
            _ReleaseArtifactOperation(
              sessionId: sessionId,
              artifactId: artifactId,
            ),
          );
        },
      ),
    );
    if (_pendingForegroundCandidates[sessionId]?.artifactId == artifactId) {
      _pendingForegroundCandidates.remove(sessionId);
    }
    if (_pendingBackgroundCandidates[sessionId]?.artifact?.artifactId ==
        artifactId) {
      _pendingBackgroundCandidates.remove(sessionId);
    }
  }

  @override
  Future<void> dispose({required int sessionId}) async {
    _intents.remove(sessionId);
    _pendingForegroundCandidates.remove(sessionId);
    _pendingBackgroundCandidates.remove(sessionId);
    await _queue.dispose(
      sessionId: sessionId,
      operation: () => _disposeNativeSession(sessionId),
    );
  }

  Future<void> close() async {
    _intents.clear();
    _pendingForegroundCandidates.clear();
    _pendingBackgroundCandidates.clear();
    await _queue.close(
      disposeSession: _disposeNativeSession,
      closeTransport: () async {
        final worker = await _worker;
        await worker.close();
      },
    );
  }

  Future<void> _disposeNativeSession(int sessionId) async {
    final worker = await _worker;
    await worker.invoke<Object?>(_DisposeOperation(sessionId));
  }

  Future<void> _releaseSupersededArtifact(RitoArtifact artifact) async {
    final worker = await _worker;
    await worker.invoke<Object?>(
      _ReleaseArtifactOperation(
        sessionId: artifact.sessionId,
        artifactId: artifact.artifactId,
      ),
    );
    if (_pendingForegroundCandidates[artifact.sessionId]?.artifactId ==
        artifact.artifactId) {
      _pendingForegroundCandidates.remove(artifact.sessionId);
    }
  }

  @override
  bool acceptsResumedExactSeekArtifact({
    required RitoArtifactRequest request,
    required RitoArtifact artifact,
  }) {
    final intent = _intents[request.sessionId];
    return intent != null &&
        intent.kind == _GatewayIntentKind.exactSeek &&
        intent.callerRequestId == request.requestId &&
        intent.requestId == artifact.requestId &&
        artifact.requestId > request.requestId;
  }

  @override
  int? latestRequestIdForExactSeek({required RitoArtifactRequest request}) {
    final intent = _intents[request.sessionId];
    if (intent == null ||
        intent.kind != _GatewayIntentKind.exactSeek ||
        intent.callerRequestId != request.requestId) {
      return null;
    }
    return intent.requestId >= request.requestId ? intent.requestId : null;
  }

  @override
  bool acceptsResumedAdjacentArtifact({
    required RitoAdjacentRequest request,
    required RitoArtifact artifact,
  }) {
    final intent = _intents[request.sessionId];
    return intent != null &&
        intent.kind == _GatewayIntentKind.adjacent &&
        intent.adjacentKey == _adjacentIntentKey(request) &&
        intent.callerRequestId == request.requestId &&
        intent.requestId == artifact.requestId &&
        artifact.requestId > request.requestId;
  }

  @override
  int? latestRequestIdForAdjacent({required RitoAdjacentRequest request}) {
    final intent = _intents[request.sessionId];
    if (intent == null ||
        intent.kind != _GatewayIntentKind.adjacent ||
        intent.adjacentKey != _adjacentIntentKey(request) ||
        intent.callerRequestId != request.requestId) {
      return null;
    }
    return intent.requestId >= request.requestId ? intent.requestId : null;
  }

  _GatewayIntent _claimExactSeekIntent(int sessionId, int callerRequestId) {
    return _claimResumableIntent(
      sessionId: sessionId,
      callerRequestId: callerRequestId,
      kind: _GatewayIntentKind.exactSeek,
    );
  }

  _GatewayIntent _claimAdjacentIntent(RitoAdjacentRequest request) {
    return _claimResumableIntent(
      sessionId: request.sessionId,
      callerRequestId: request.requestId,
      kind: _GatewayIntentKind.adjacent,
      adjacentKey: _adjacentIntentKey(request),
    );
  }

  _GatewayIntent _claimResumableIntent({
    required int sessionId,
    required int callerRequestId,
    required _GatewayIntentKind kind,
    _AdjacentIntentKey? adjacentKey,
  }) {
    final previous = _intents[sessionId];
    var nativeRequestId = callerRequestId;
    if (previous != null && nativeRequestId <= previous.requestId) {
      if (previous.requestId >= 0x7fffffffffffffff) {
        throw StateError('Rito reader request ID space is exhausted.');
      }
      nativeRequestId = previous.requestId + 1;
    }
    final intent = _GatewayIntent(
      sessionId: sessionId,
      callerRequestId: callerRequestId,
      requestId: nativeRequestId,
      kind: kind,
      adjacentKey: adjacentKey,
    );
    _intents[sessionId] = intent;
    return intent;
  }

  bool _isCurrent(_GatewayIntent intent) {
    return identical(_intents[intent.sessionId], intent);
  }

  int? _replacementRequestId(_GatewayIntent intent) {
    final current = _intents[intent.sessionId];
    return identical(current, intent) ? null : current?.callerRequestId;
  }

  void _forgetIntent(_GatewayIntent intent) {
    if (_isCurrent(intent)) {
      _intents.remove(intent.sessionId);
    }
  }

  RitoNavigationSupersededException _superseded(_GatewayIntent intent) {
    return RitoNavigationSupersededException(
      sessionId: intent.sessionId,
      requestId: intent.callerRequestId,
      replacementRequestId: _replacementRequestId(intent),
    );
  }

  Future<void> _finishPendingExactSeek(
    _GatewayIntent intent,
    Object error, {
    required bool opening,
  }) async {
    if (!_isCurrent(intent)) {
      throw _superseded(intent);
    }
    if (!opening && _isTargetNotPublished(error)) {
      return;
    }
    _forgetIntent(intent);
    await _queue.dispose(
      sessionId: intent.sessionId,
      operation: () => _disposeNativeSession(intent.sessionId),
    );
  }

  Future<void> _finishPendingAdjacent(
    _GatewayIntent intent,
    Object error,
  ) async {
    if (!_isCurrent(intent)) {
      throw _superseded(intent);
    }
    if (_isTargetNotPublished(error)) {
      return;
    }
    _forgetIntent(intent);
    await _queue.dispose(
      sessionId: intent.sessionId,
      operation: () => _disposeNativeSession(intent.sessionId),
    );
  }

  static bool _isExactSeekPending(Object error) {
    return error is RitoNativeException &&
        error.status == ritoNativeStatusExactSeekPendingV1;
  }

  static bool _isAdjacentPending(Object error) {
    return error is RitoNativeException &&
        error.status == ritoNativeStatusAdjacentPendingV1;
  }

  static bool _isTargetNotPublished(Object error) {
    return error is RitoNativeException &&
        error.status == ritoNativeStatusTargetNotPublishedV1;
  }

  static Future<void> _yieldHostTurn() {
    return Future<void>.delayed(Duration.zero);
  }

  int _diagnosticRequestId(int sessionId) {
    return _pendingForegroundCandidates[sessionId]?.requestId ??
        _pendingBackgroundCandidates[sessionId]?.intentRequestId ??
        _intents[sessionId]?.requestId ??
        1;
  }

  Future<T> _guardNativeMutation<T>({
    required int sessionId,
    required int requestId,
    required Future<T> Function() operation,
  }) {
    return _guardNativeSessionOperation<T>(
      sessionId: sessionId,
      requestId: requestId,
      operation: operation,
    );
  }

  Future<T> _guardNativeSessionOperation<T>({
    required int sessionId,
    required int requestId,
    required Future<T> Function() operation,
  }) {
    return _queue.guardSessionOperation<T>(
      sessionId: sessionId,
      requestId: requestId,
      operation: operation,
      requiresFailClose: _sessionFailureRequiresFailClose,
      disposeSession: () => _disposeNativeSession(sessionId),
    );
  }

  static bool _sessionFailureRequiresFailClose(Object error) {
    if (error is RitoNativeSessionInvalidatedException) {
      return false;
    }
    if (error is! RitoNativeException) {
      // Worker exit, malformed isolate replies, and transfer failures cannot
      // prove whether the actor committed the mutation before transport died.
      return true;
    }
    if (error.status == ritoNativeStatusSessionTerminatedV1 ||
        error.status == ritoNativeStatusPanicV1) {
      return true;
    }
    return error.status != ritoNativeStatusInvalidArgumentV1 &&
        error.status != ritoNativeStatusNotFoundV1 &&
        error.status != ritoNativeStatusAlreadyExistsV1 &&
        error.status != ritoNativeStatusEngineErrorV1 &&
        error.status != ritoNativeStatusStaleRequestV1 &&
        error.status != ritoNativeStatusTargetNotPublishedV1 &&
        error.status != ritoNativeStatusUnsupportedProfileV1 &&
        error.status != ritoNativeStatusBusyV1 &&
        error.status != ritoNativeStatusExactSeekPendingV1 &&
        error.status != ritoNativeStatusAdjacentPendingV1;
  }

  Future<T> _decodeSessionWire<T>({
    required int sessionId,
    required String field,
    required Uint8List wireBytes,
    required T Function(Uint8List bytes) decode,
    required bool Function(T value) validate,
  }) async {
    try {
      final value = decode(wireBytes);
      if (!validate(value)) {
        throw RitoNativeException(
          status: 4,
          message: 'Native $field identity does not match its request.',
        );
      }
      return value;
    } on Object catch (error, stackTrace) {
      return _rejectMalformedSessionWire(
        sessionId: sessionId,
        field: field,
        contractError: error,
        contractStackTrace: stackTrace,
      );
    }
  }

  Future<Never> _rejectMalformedSessionWire({
    required int sessionId,
    required String field,
    required Object contractError,
    required StackTrace contractStackTrace,
  }) async {
    final invalidation = await _queue.failClosed(
      sessionId: sessionId,
      requestId: _intents[sessionId]?.requestId ?? 1,
      cleanupError: RitoNativeException(
        status: 4,
        message: 'Malformed native $field: $contractError',
      ),
      cleanupStackTrace: contractStackTrace,
      nativeSessionMayExist: true,
      disposeSession: () => _disposeNativeSession(sessionId),
    );
    Error.throwWithStackTrace(invalidation, contractStackTrace);
  }

  Future<RitoArtifact> _decodeArtifact({
    required Uint8List wireBytes,
    required int sessionId,
    required int requestId,
  }) async {
    try {
      final artifact = _artifactDecoder.decode(wireBytes);
      if (artifact.sessionId != sessionId || artifact.requestId != requestId) {
        throw const RitoNativeException(
          status: 4,
          message: 'Native artifact identity does not match its request.',
        );
      }
      _pendingForegroundCandidates[sessionId] = artifact;
      _pendingBackgroundCandidates.remove(sessionId);
      return artifact;
    } on Object catch (error, stackTrace) {
      return _rejectMalformedArtifact(
        sessionId: sessionId,
        requestId: requestId,
        contractError: error,
        contractStackTrace: stackTrace,
      );
    }
  }

  Future<Never> _rejectMalformedArtifact({
    required int sessionId,
    required int requestId,
    required Object contractError,
    required StackTrace contractStackTrace,
  }) async {
    final invalidation = await _queue.failClosed(
      sessionId: sessionId,
      requestId: requestId,
      cleanupError: contractError,
      cleanupStackTrace: contractStackTrace,
      nativeSessionMayExist: true,
      disposeSession: () => _disposeNativeSession(sessionId),
    );
    Error.throwWithStackTrace(invalidation, contractStackTrace);
  }
}

final class _GatewayIntent {
  _GatewayIntent({
    required this.sessionId,
    required this.callerRequestId,
    required this.requestId,
    required this.kind,
    this.adjacentKey,
  });

  final int sessionId;
  final int callerRequestId;
  final _GatewayIntentKind kind;
  final _AdjacentIntentKey? adjacentKey;
  int requestId;
}

enum _GatewayIntentKind { exactSeek, adjacent }

typedef _AdjacentIntentKey = ({
  int fromArtifactId,
  RitoAdjacentDirection direction,
  int localPageCap,
});

_AdjacentIntentKey _adjacentIntentKey(RitoAdjacentRequest request) {
  return (
    fromArtifactId: request.fromArtifactId,
    direction: request.direction,
    localPageCap: request.work.localPageCap,
  );
}

RitoArtifactRequest _oneQuantumRequestWithId(
  RitoArtifactRequest request,
  int requestId,
) {
  return RitoArtifactRequest(
    sessionId: request.sessionId,
    requestId: requestId,
    layout: request.layout,
    locator: request.locator,
    work: RitoWorkBudget(
      maxTopLevelNodesPerQuantum: request.work.maxTopLevelNodesPerQuantum,
      maxForegroundQuanta: 1,
      localPageCap: request.work.localPageCap,
    ),
    textProfile: request.textProfile,
  );
}
