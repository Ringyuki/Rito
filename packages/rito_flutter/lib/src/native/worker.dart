part of 'gateway.dart';

/// The native engine, called on the isolate that holds the gateway. Every
/// operation runs to completion before it returns, so an answer is ready
/// within the task that asked for it and a host can lay a page out and
/// draw it in the same frame. The engine's work holds the isolate for as
/// long as it takes, which is why the work a session does on its own (the
/// whole book behind the page shown) comes in small steps.
final class _RitoEngineClient {
  _RitoEngineClient(this._bindings);

  factory _RitoEngineClient.start(
    RitoDynamicLibrarySource? diagnosticLibrary,
  ) => _RitoEngineClient(switch (diagnosticLibrary) {
    null => RitoNativeWireBindings(),
    final library => RitoNativeWireBindings.fromDynamicLibrary(library.open()),
  });

  final RitoNativeWireBindings _bindings;
  final Set<int> _liveSessions = <int>{};
  bool _closed = false;

  /// Completes at once: no operation outlives the call that made it.
  Future<void> whenIdle() => Future<void>.value();

  Future<T> invoke<T>(_WorkerOperation operation) =>
      Future<T>.sync(() => _run(operation) as T);

  Future<Uint8List> invokeWire(_WorkerOperation operation) =>
      Future<Uint8List>.sync(() => _run(operation)! as Uint8List);

  /// Disposes every session still open; later operations fail.
  Future<void> close() => Future<void>.sync(() {
    if (_closed) return;
    _closed = true;
    _perform(_bindings, const _CloseOperation(), _liveSessions);
  });

  Object? _run(_WorkerOperation operation) {
    if (_closed) throw StateError('Rito native engine is closed.');
    return _perform(_bindings, operation, _liveSessions);
  }
}

/// Runs an operation that answers with nothing but its success.
Object? _done(void Function() operation) {
  operation();
  return null;
}

Object? _perform(
  RitoNativeWireBindings bindings,
  _WorkerOperation operation,
  Set<int> liveSessions,
) {
  return switch (operation) {
    _OpenOperation() => _open(bindings, operation, liveSessions),
    _OpenShardsOperation() => _openShards(bindings, operation, liveSessions),
    _SupplyShardOperation() => bindings.supplyShard(
      sessionId: operation.sessionId,
      shardBytes: operation.shardBytes,
      key: operation.key,
    ),
    _ContentShardsNearOperation() => bindings.contentShardsNear(
      sessionId: operation.sessionId,
      href: operation.href,
    ),
    _FontCatalogOperation() => bindings.fontCatalogWire(
      sessionId: operation.sessionId,
    ),
    _UnresolvedFontFamiliesOperation() => bindings.unresolvedFontFamiliesWire(
      sessionId: operation.sessionId,
      familyList: operation.familyList,
    ),
    _AddHostFontFacesOperation() => _done(
      () => bindings.addHostFontFaces(
        sessionId: operation.sessionId,
        faces: operation.faces,
      ),
    ),
    _RemoveHostFontFacesOperation() => _done(
      () => bindings.removeHostFontFaces(
        sessionId: operation.sessionId,
        sha256s: operation.sha256s,
      ),
    ),
    _MarkFontFamiliesUnavailableOperation() => _done(() {
      for (final family in operation.families) {
        bindings.markFontFamilyUnavailable(
          sessionId: operation.sessionId,
          family: family,
        );
      }
    }),
    _RequestArtifactOperation() => bindings.requestArtifactEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _RequestAdjacentOperation() => bindings.requestAdjacentEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _PeekAdjacentOperation() => bindings.peekAdjacentEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _PeekSpreadOperation() => bindings.peekSpreadEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _CommitPeekedOperation() => bindings.commitPeekedArtifactEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadPublicationOperation() => bindings.readPublicationEncoded(
      sessionId: operation.sessionId,
    ),
    _AdoptForegroundOperation() => bindings.adoptForegroundCandidateEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _AdvanceBackgroundOperation() => bindings.advanceBackgroundEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _AdoptBackgroundOperation() => bindings.adoptBackgroundCandidateEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadResourceOperation() => bindings.readResource(
      sessionId: operation.sessionId,
      artifactId: operation.artifactId,
      kind: operation.kind,
      href: operation.href,
    ),
    _SearchOperation() => bindings.searchEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _TextRangeGeometryOperation() => bindings.textRangeGeometryEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ExactSourceRangeOperation() => bindings.exactSourceRangeEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _TextInteractionOperation() => bindings.textInteractionEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _AnnotationOperation() => bindings.annotationEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _NavigationOperation() => bindings.navigationEncoded(
      sessionId: operation.sessionId,
      requestBytes: operation.requestBytes,
    ),
    _ReadFootnoteOperation() => bindings.readFootnote(
      sessionId: operation.sessionId,
      artifactId: operation.artifactId,
      key: operation.key,
    ),
    _ReadPageOperation() => bindings.readPage(
      sessionId: operation.sessionId,
      artifactId: operation.artifactId,
      pageIndex: operation.pageIndex,
    ),
    _ReleaseArtifactOperation() => _release(bindings, operation),
    _DisposeOperation() => _dispose(bindings, operation, liveSessions),
    _CloseOperation() => _disposeAll(bindings, liveSessions),
  };
}

Uint8List _open(
  RitoNativeWireBindings bindings,
  _OpenOperation operation,
  Set<int> liveSessions,
) {
  // A failed open registers no native session, so only success is tracked.
  final faces = operation.pinnedFontFaces;
  final wireBytes = bindings.openEncoded(
    publicationBytes: operation.publicationBytes,
    requestBytes: operation.requestBytes,
    pinnedFontPolicy: faces == null
        ? null
        : RitoPinnedFontPolicy(
            faces: <RitoPinnedFontFace>[
              for (final face in faces)
                RitoPinnedFontFace(
                  bytes: face.bytes,
                  sha256Hex: face.sha256Hex,
                  genericRole: face.genericRole,
                  language: face.language,
                ),
            ],
          ),
  );
  liveSessions.add(operation.sessionId);
  return wireBytes;
}

Uint8List _openShards(
  RitoNativeWireBindings bindings,
  _OpenShardsOperation operation,
  Set<int> liveSessions,
) {
  // A failed open registers no native session, so only success is tracked.
  final wireBytes = bindings.openShardsEncoded(
    skeletonBytes: operation.skeletonBytes,
    skeletonKey: operation.skeletonKey,
    requestBytes: operation.requestBytes,
    pinnedFontPolicy: _pinnedPolicy(operation.pinnedFontFaces),
  );
  liveSessions.add(operation.sessionId);
  return wireBytes;
}

RitoPinnedFontPolicy _pinnedPolicy(List<_PinnedFontFaceTransfer> faces) {
  return RitoPinnedFontPolicy(
    faces: <RitoPinnedFontFace>[
      for (final face in faces)
        RitoPinnedFontFace(
          bytes: face.bytes,
          sha256Hex: face.sha256Hex,
          genericRole: face.genericRole,
          language: face.language,
        ),
    ],
  );
}

Object? _release(
  RitoNativeWireBindings bindings,
  _ReleaseArtifactOperation operation,
) {
  bindings.releaseArtifact(
    sessionId: operation.sessionId,
    artifactId: operation.artifactId,
  );
  return null;
}

Object? _dispose(
  RitoNativeWireBindings bindings,
  _DisposeOperation operation,
  Set<int> liveSessions,
) {
  bindings.dispose(sessionId: operation.sessionId);
  liveSessions.remove(operation.sessionId);
  return null;
}

Object? _disposeAll(RitoNativeWireBindings bindings, Set<int> liveSessions) {
  Object? firstError;
  StackTrace? firstStackTrace;
  for (final sessionId in liveSessions.toList(growable: false)) {
    try {
      bindings.dispose(sessionId: sessionId);
      liveSessions.remove(sessionId);
    } on Object catch (error, stackTrace) {
      firstError ??= error;
      firstStackTrace ??= stackTrace;
    }
  }
  if (firstError != null) {
    Error.throwWithStackTrace(firstError, firstStackTrace!);
  }
  return null;
}

sealed class _WorkerOperation {
  const _WorkerOperation();
}

final class _OpenOperation extends _WorkerOperation {
  const _OpenOperation({
    required this.sessionId,
    required this.publicationBytes,
    required this.requestBytes,
    this.pinnedFontFaces,
  });

  final int sessionId;
  final Uint8List publicationBytes;
  final Uint8List requestBytes;
  final List<_PinnedFontFaceTransfer>? pinnedFontFaces;
}

/// One pinned face handed to the engine's open.
final class _PinnedFontFaceTransfer {
  const _PinnedFontFaceTransfer({
    required this.bytes,
    required this.sha256Hex,
    required this.genericRole,
    required this.language,
  });

  final Uint8List bytes;
  final String sha256Hex;
  final RitoPinnedFontGenericRole genericRole;
  final String? language;
}

final class _OpenShardsOperation extends _WorkerOperation {
  const _OpenShardsOperation({
    required this.sessionId,
    required this.skeletonBytes,
    required this.skeletonKey,
    required this.requestBytes,
    required this.pinnedFontFaces,
  });

  final int sessionId;
  final Uint8List skeletonBytes;
  final Uint8List? skeletonKey;
  final Uint8List requestBytes;
  final List<_PinnedFontFaceTransfer> pinnedFontFaces;
}

final class _SupplyShardOperation extends _WorkerOperation {
  const _SupplyShardOperation({
    required this.sessionId,
    required this.shardBytes,
    required this.key,
  });

  final int sessionId;
  final Uint8List shardBytes;
  final Uint8List? key;
}

final class _ContentShardsNearOperation extends _WorkerOperation {
  const _ContentShardsNearOperation({
    required this.sessionId,
    required this.href,
  });

  final int sessionId;
  final String href;
}

final class _RequestArtifactOperation extends _WorkerOperation {
  const _RequestArtifactOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _RequestAdjacentOperation extends _WorkerOperation {
  const _RequestAdjacentOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _PeekAdjacentOperation extends _WorkerOperation {
  const _PeekAdjacentOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _PeekSpreadOperation extends _WorkerOperation {
  const _PeekSpreadOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _CommitPeekedOperation extends _WorkerOperation {
  const _CommitPeekedOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadPublicationOperation extends _WorkerOperation {
  const _ReadPublicationOperation(this.sessionId);

  final int sessionId;
}

final class _AdoptForegroundOperation extends _WorkerOperation {
  const _AdoptForegroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _AdvanceBackgroundOperation extends _WorkerOperation {
  const _AdvanceBackgroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _AdoptBackgroundOperation extends _WorkerOperation {
  const _AdoptBackgroundOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadResourceOperation extends _WorkerOperation {
  const _ReadResourceOperation({
    required this.sessionId,
    required this.artifactId,
    required this.kind,
    required this.href,
  });

  final int sessionId;
  final int artifactId;
  final RitoResourceKind kind;
  final String href;
}

final class _SearchOperation extends _WorkerOperation {
  const _SearchOperation({required this.sessionId, required this.requestBytes});

  final int sessionId;
  final Uint8List requestBytes;
}

final class _TextRangeGeometryOperation extends _WorkerOperation {
  const _TextRangeGeometryOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ExactSourceRangeOperation extends _WorkerOperation {
  const _ExactSourceRangeOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _TextInteractionOperation extends _WorkerOperation {
  const _TextInteractionOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _AnnotationOperation extends _WorkerOperation {
  const _AnnotationOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _NavigationOperation extends _WorkerOperation {
  const _NavigationOperation({
    required this.sessionId,
    required this.requestBytes,
  });

  final int sessionId;
  final Uint8List requestBytes;
}

final class _ReadFootnoteOperation extends _WorkerOperation {
  const _ReadFootnoteOperation({
    required this.sessionId,
    required this.artifactId,
    required this.key,
  });

  final int sessionId;
  final int artifactId;
  final String key;
}

final class _ReadPageOperation extends _WorkerOperation {
  const _ReadPageOperation({
    required this.sessionId,
    required this.artifactId,
    required this.pageIndex,
  });

  final int sessionId;
  final int artifactId;
  final int pageIndex;
}

final class _ReleaseArtifactOperation extends _WorkerOperation {
  const _ReleaseArtifactOperation({
    required this.sessionId,
    required this.artifactId,
  });

  final int sessionId;
  final int artifactId;
}

final class _DisposeOperation extends _WorkerOperation {
  const _DisposeOperation(this.sessionId);

  final int sessionId;
}

final class _CloseOperation extends _WorkerOperation {
  const _CloseOperation();
}
