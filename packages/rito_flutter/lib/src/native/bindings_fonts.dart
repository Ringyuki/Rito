part of 'bindings.dart';

/// The session's fonts across the C ABI (see `rito_font_catalog` and its
/// siblings): the `RITOFNT1` catalog, the `RITOFNN1` names a `font-family`
/// list would skip, and host faces added or removed while the session is
/// open.
extension RitoNativeFontBindings on RitoNativeBindings {
  /// The session's font catalog as a `RITOFNT1` message.
  Uint8List fontCatalogWire({required int sessionId}) {
    _validateId(sessionId, 'session id');
    return _ownedCall(
      'font catalog',
      (out, error) => _fontCatalog(sessionId, out, error),
    );
  }

  /// The names in [familyList] no family in the catalog answers to, as a
  /// `RITOFNN1` message.
  Uint8List unresolvedFontFamiliesWire({
    required int sessionId,
    required String familyList,
  }) {
    _validateId(sessionId, 'session id');
    final bytes = Uint8List.fromList(utf8.encode(familyList));
    final input = _copyInput(bytes);
    try {
      return _ownedCall(
        'unresolved font families',
        (out, error) =>
            _unresolvedFontFamilies(sessionId, input, bytes.length, out, error),
      );
    } finally {
      calloc.free(input);
    }
  }

  /// Adds host faces after the session's.
  void addHostFontFaces({
    required int sessionId,
    required List<RitoPinnedFontFace> faces,
  }) {
    _validateId(sessionId, 'session id');
    final allocations = <Pointer<NativeType>>[];
    try {
      final descriptors = _marshalPinnedFontFaces(
        RitoPinnedFontPolicy(faces: faces),
        allocations,
      );
      _statusCall(
        (error) =>
            _addHostFontFaces(sessionId, descriptors, faces.length, error),
      );
    } finally {
      for (final allocation in allocations) {
        calloc.free(allocation);
      }
    }
  }

  /// Removes host faces by their SHA-256 hex digests.
  void removeHostFontFaces({
    required int sessionId,
    required List<String> sha256s,
  }) {
    _validateId(sessionId, 'session id');
    final digests = Uint8List.fromList(ascii.encode(sha256s.join()));
    if (sha256s.isEmpty || digests.length != sha256s.length * 64) {
      throw ArgumentError.value(
        sha256s,
        'sha256s',
        'must be 64-digit hexadecimal digests',
      );
    }
    final input = _copyInput(digests);
    try {
      _statusCall(
        (error) =>
            _removeHostFontFaces(sessionId, input, sha256s.length, error),
      );
    } finally {
      calloc.free(input);
    }
  }

  Uint8List _ownedCall(
    String what,
    int Function(Pointer<_RitoOwnedBuffer> out, Pointer<_RitoOwnedBuffer> error)
    call,
  ) {
    final out = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = call(out, errorOut);
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      return _copyOutput(out, what);
    } finally {
      _bufferFree(out);
      _bufferFree(errorOut);
      calloc
        ..free(out)
        ..free(errorOut);
    }
  }

  void _statusCall(int Function(Pointer<_RitoOwnedBuffer> error) call) {
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = call(errorOut);
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
    } finally {
      _bufferFree(errorOut);
      calloc.free(errorOut);
    }
  }
}
