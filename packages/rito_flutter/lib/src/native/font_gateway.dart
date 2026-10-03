part of 'gateway.dart';

/// Gateways that expose an open session's fonts: the catalog a host builds
/// its font choices from, the names a `font-family` list would skip, and
/// host faces added or removed while the session is open.
abstract interface class RitoFontGateway {
  Future<RitoFontCatalog> fontCatalog({required int sessionId});

  Future<List<String>> unresolvedFontFamilies({
    required int sessionId,
    required String familyList,
  });

  /// Adds host faces. Artifacts already published keep their layout; the
  /// next request lays out again with the new faces nameable.
  Future<void> addHostFontFaces({
    required int sessionId,
    required List<RitoPinnedFontFace> faces,
  });

  /// Removes host faces by SHA-256; at least one must remain.
  Future<void> removeHostFontFaces({
    required int sessionId,
    required List<String> sha256s,
  });
}

extension _FontOperations on RitoIsolateGateway {
  /// Runs a font query in the session's order and decodes its message.
  Future<T> _fontQuery<T>(
    int sessionId,
    _WorkerOperation operation,
    T Function(Uint8List wire) decode,
  ) {
    return _queue.ordered<T>(
      sessionId: sessionId,
      operation: () async {
        final worker = await _worker;
        return decode(await worker.invokeWire(operation));
      },
    );
  }

  /// Runs a font edit in the session's order.
  Future<void> _fontEdit(int sessionId, _WorkerOperation operation) {
    return _queue.ordered<void>(
      sessionId: sessionId,
      operation: () async {
        final worker = await _worker;
        await worker.invoke<void>(operation);
      },
    );
  }
}

final class _FontCatalogOperation extends _WorkerOperation {
  const _FontCatalogOperation({required this.sessionId});

  final int sessionId;
}

final class _UnresolvedFontFamiliesOperation extends _WorkerOperation {
  const _UnresolvedFontFamiliesOperation({
    required this.sessionId,
    required this.familyList,
  });

  final int sessionId;
  final String familyList;
}

final class _AddHostFontFacesOperation extends _WorkerOperation {
  const _AddHostFontFacesOperation({
    required this.sessionId,
    required this.faces,
  });

  final int sessionId;
  final List<RitoPinnedFontFace> faces;
}

final class _RemoveHostFontFacesOperation extends _WorkerOperation {
  const _RemoveHostFontFacesOperation({
    required this.sessionId,
    required this.sha256s,
  });

  final int sessionId;
  final List<String> sha256s;
}
