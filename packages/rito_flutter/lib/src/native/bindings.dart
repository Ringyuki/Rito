import 'dart:convert';
import 'dart:ffi';
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

import '../protocol/artifact_decoder.dart';
import '../protocol/artifact_models.dart';
import '../protocol/binary_reader.dart';
import '../protocol/resource_decoder.dart';
import 'asset.dart';
import 'pinned_font_policy.dart';

part 'ffi_types.dart';

const int ritoNativeStatusInvalidArgumentV1 = 1;
const int ritoNativeStatusNotFoundV1 = 2;
const int ritoNativeStatusAlreadyExistsV1 = 3;
const int ritoNativeStatusEngineErrorV1 = 4;
const int ritoNativeStatusStaleRequestV1 = 5;
const int ritoNativeStatusTargetNotPublishedV1 = 6;
const int ritoNativeStatusUnsupportedProfileV1 = 7;
const int ritoNativeStatusBusyV1 = 8;
const int ritoNativeStatusExactSeekPendingV1 = 9;
const int ritoNativeStatusAdjacentPendingV1 = 10;
const int ritoNativeStatusSessionTerminatedV1 = 11;
const int ritoNativeStatusPanicV1 = 255;

final class RitoNativeException implements Exception {
  const RitoNativeException({required this.status, required this.message});

  final int status;
  final String message;

  @override
  String toString() => 'RitoNativeException($status): $message';
}

@Native<_OpenNative>(symbol: 'rito_open_v1', assetId: ritoNativeAssetId)
external int _ritoOpenV1(
  Pointer<Uint8> publication,
  int publicationLength,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> artifactOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_OpenWithPinnedFontsNative>(
  symbol: 'rito_open_with_pinned_fonts_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoOpenWithPinnedFontsV1(
  Pointer<Uint8> publication,
  int publicationLength,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoPinnedFontFace> faces,
  int faceCount,
  Pointer<_RitoOwnedBuffer> artifactOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_RequestArtifactNative>(
  symbol: 'rito_request_artifact_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoRequestArtifactV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> artifactOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_RequestAdjacentNative>(
  symbol: 'rito_request_adjacent_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoRequestAdjacentV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> artifactOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_RequestAdjacentNative>(
  symbol: 'rito_peek_adjacent_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoPeekAdjacentV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> artifactOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_OwnedWireRequestNative>(
  symbol: 'rito_commit_peeked_artifact_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoCommitPeekedArtifactV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> ackOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_ReadPublicationNative>(
  symbol: 'rito_read_publication_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoReadPublicationV1(
  int sessionId,
  Pointer<_RitoOwnedBuffer> publicationOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_OwnedWireRequestNative>(
  symbol: 'rito_adopt_foreground_candidate_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoAdoptForegroundCandidateV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> ackOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_OwnedWireRequestNative>(
  symbol: 'rito_advance_background_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoAdvanceBackgroundV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> advanceOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_OwnedWireRequestNative>(
  symbol: 'rito_adopt_background_candidate_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoAdoptBackgroundCandidateV1(
  int sessionId,
  Pointer<Uint8> request,
  int requestLength,
  Pointer<_RitoOwnedBuffer> ackOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_ReadResourceNative>(
  symbol: 'rito_read_resource_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoReadResourceV1(
  int sessionId,
  int artifactId,
  int kind,
  Pointer<Uint8> href,
  int hrefLength,
  Pointer<_RitoOwnedBuffer> resourceOut,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_ReleaseNative>(
  symbol: 'rito_release_artifact_v1',
  assetId: ritoNativeAssetId,
)
external int _ritoReleaseArtifactV1(
  int sessionId,
  int artifactId,
  Pointer<_RitoOwnedBuffer> errorOut,
);

@Native<_DisposeNative>(symbol: 'rito_dispose_v1', assetId: ritoNativeAssetId)
external int _ritoDisposeV1(int sessionId, Pointer<_RitoOwnedBuffer> errorOut);

@Native<_BufferFreeNative>(
  symbol: 'rito_buffer_free_v1',
  assetId: ritoNativeAssetId,
)
external void _ritoBufferFreeV1(Pointer<_RitoOwnedBuffer> buffer);

/// Blocking C ABI binding. Applications should normally use
/// `RitoIsolateGateway`, which constructs this binding on a worker isolate.
final class RitoNativeBindings {
  RitoNativeBindings({
    this.artifactDecoder = const RitoArtifactDecoder(),
    this.resourceDecoder = const RitoResourceDecoder(),
  }) : _open = _ritoOpenV1,
       _openWithPinnedFonts = _ritoOpenWithPinnedFontsV1,
       _requestArtifact = _ritoRequestArtifactV1,
       _requestAdjacent = _ritoRequestAdjacentV1,
       _peekAdjacent = _ritoPeekAdjacentV1,
       _commitPeeked = _ritoCommitPeekedArtifactV1,
       _readPublication = _ritoReadPublicationV1,
       _adoptForeground = _ritoAdoptForegroundCandidateV1,
       _advanceBackground = _ritoAdvanceBackgroundV1,
       _adoptBackground = _ritoAdoptBackgroundCandidateV1,
       _readResource = _ritoReadResourceV1,
       _release = _ritoReleaseArtifactV1,
       _dispose = _ritoDisposeV1,
       _bufferFree = _ritoBufferFreeV1;

  /// Opens symbols from an explicitly supplied library for tests and native
  /// embedding diagnostics. Product callers should use the default constructor
  /// so Flutter resolves the bundled Native Asset.
  RitoNativeBindings.fromDynamicLibrary(
    DynamicLibrary library, {
    this.artifactDecoder = const RitoArtifactDecoder(),
    this.resourceDecoder = const RitoResourceDecoder(),
  }) : _open = library.lookupFunction<_OpenNative, _OpenDart>('rito_open_v1'),
       _openWithPinnedFonts = library
           .lookupFunction<
             _OpenWithPinnedFontsNative,
             _OpenWithPinnedFontsDart
           >('rito_open_with_pinned_fonts_v1'),
       _requestArtifact = library
           .lookupFunction<_RequestArtifactNative, _RequestArtifactDart>(
             'rito_request_artifact_v1',
           ),
       _requestAdjacent = library
           .lookupFunction<_RequestAdjacentNative, _RequestAdjacentDart>(
             'rito_request_adjacent_v1',
           ),
       _peekAdjacent = library
           .lookupFunction<_RequestAdjacentNative, _RequestAdjacentDart>(
             'rito_peek_adjacent_v1',
           ),
       _commitPeeked = library
           .lookupFunction<_OwnedWireRequestNative, _OwnedWireRequestDart>(
             'rito_commit_peeked_artifact_v1',
           ),
       _readPublication = library
           .lookupFunction<_ReadPublicationNative, _ReadPublicationDart>(
             'rito_read_publication_v1',
           ),
       _adoptForeground = library
           .lookupFunction<_OwnedWireRequestNative, _OwnedWireRequestDart>(
             'rito_adopt_foreground_candidate_v1',
           ),
       _advanceBackground = library
           .lookupFunction<_OwnedWireRequestNative, _OwnedWireRequestDart>(
             'rito_advance_background_v1',
           ),
       _adoptBackground = library
           .lookupFunction<_OwnedWireRequestNative, _OwnedWireRequestDart>(
             'rito_adopt_background_candidate_v1',
           ),
       _readResource = library
           .lookupFunction<_ReadResourceNative, _ReadResourceDart>(
             'rito_read_resource_v1',
           ),
       _release = library.lookupFunction<_ReleaseNative, _ReleaseDart>(
         'rito_release_artifact_v1',
       ),
       _dispose = library.lookupFunction<_DisposeNative, _DisposeDart>(
         'rito_dispose_v1',
       ),
       _bufferFree = library.lookupFunction<_BufferFreeNative, _BufferFreeDart>(
         'rito_buffer_free_v1',
       );

  final RitoArtifactDecoder artifactDecoder;
  final RitoResourceDecoder resourceDecoder;
  final _OpenDart _open;
  final _OpenWithPinnedFontsDart _openWithPinnedFonts;
  final _RequestArtifactDart _requestArtifact;
  final _RequestAdjacentDart _requestAdjacent;
  final _RequestAdjacentDart _peekAdjacent;
  final _OwnedWireRequestDart _commitPeeked;
  final _ReadPublicationDart _readPublication;
  final _OwnedWireRequestDart _adoptForeground;
  final _OwnedWireRequestDart _advanceBackground;
  final _OwnedWireRequestDart _adoptBackground;
  final _ReadResourceDart _readResource;
  final _ReleaseDart _release;
  final _DisposeDart _dispose;
  final _BufferFreeDart _bufferFree;

  RitoArtifact openEncoded({
    required Uint8List publicationBytes,
    required Uint8List requestBytes,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) {
    final owned = _openEncodedWire(
      publicationBytes: publicationBytes,
      requestBytes: requestBytes,
      pinnedFontPolicy: pinnedFontPolicy,
    );
    try {
      final artifact = artifactDecoder.decode(owned);
      _validateArtifactIdentity(
        artifact,
        sessionId: _acceptedRequestSessionId(requestBytes),
        requestId: _acceptedRequestId(requestBytes),
      );
      return artifact;
    } on Object catch (error, stackTrace) {
      // A successful open has already registered the native session. If the
      // returned artifact is malformed, no RitoReaderSession exists to own
      // that session, so roll it back before surfacing the decode failure.
      _disposeAfterFailedSessionOutput(_acceptedRequestSessionId(requestBytes));
      Error.throwWithStackTrace(
        _terminatedSessionResultError('initial artifact', error),
        stackTrace,
      );
    }
  }

  Uint8List _openEncodedWire({
    required Uint8List publicationBytes,
    required Uint8List requestBytes,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) {
    _validateInput(publicationBytes, 512 * 1024 * 1024, 'publication');
    _validateInput(requestBytes, 16 * 1024 * 1024, 'request');
    final publication = _copyInput(publicationBytes);
    final request = _copyInput(requestBytes);
    final artifactOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    final faceAllocations = <Pointer<NativeType>>[];
    try {
      final int status;
      if (pinnedFontPolicy == null) {
        status = _open(
          publication,
          publicationBytes.length,
          request,
          requestBytes.length,
          artifactOut,
          errorOut,
        );
      } else {
        final faces = _marshalPinnedFontFaces(
          pinnedFontPolicy,
          faceAllocations,
        );
        status = _openWithPinnedFonts(
          publication,
          publicationBytes.length,
          request,
          requestBytes.length,
          faces,
          pinnedFontPolicy.faces.length,
          artifactOut,
          errorOut,
        );
      }
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(artifactOut, 'artifact');
      } on Object catch (error, stackTrace) {
        // The native open succeeded, but its owned output could not be copied.
        _disposeAfterFailedSessionOutput(
          _acceptedRequestSessionId(requestBytes),
        );
        Error.throwWithStackTrace(
          _terminatedSessionResultError('initial artifact', error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(artifactOut);
      _bufferFree(errorOut);
      calloc
        ..free(artifactOut)
        ..free(errorOut)
        ..free(publication)
        ..free(request);
      for (final allocation in faceAllocations) {
        calloc.free(allocation);
      }
    }
  }

  /// Marshals the pinned-face array for `rito_open_with_pinned_fonts_v1`.
  /// Every allocation is appended to [allocations] so the caller frees
  /// them after the native call returns (the ABI copies before then).
  Pointer<_RitoPinnedFontFace> _marshalPinnedFontFaces(
    RitoPinnedFontPolicy policy,
    List<Pointer<NativeType>> allocations,
  ) {
    final faces = calloc<_RitoPinnedFontFace>(policy.faces.length);
    allocations.add(faces);
    for (var index = 0; index < policy.faces.length; index += 1) {
      final face = policy.faces[index];
      final entry = faces + index;
      final bytes = _copyInput(face.bytes);
      allocations.add(bytes);
      entry.ref.bytesData = bytes;
      entry.ref.bytesLen = face.bytes.length;
      final digest = ascii.encode(face.sha256Hex);
      for (var offset = 0; offset < 64; offset += 1) {
        entry.ref.sha256Hex[offset] = digest[offset];
      }
      entry.ref.genericRole = switch (face.genericRole) {
        RitoPinnedFontGenericRole.serif => 0,
        RitoPinnedFontGenericRole.sansSerif => 1,
        RitoPinnedFontGenericRole.monospace => 2,
      };
      final language = face.language;
      if (language == null) {
        entry.ref.languageData = nullptr;
        entry.ref.languageLen = 0;
      } else {
        final languageBytes = Uint8List.fromList(ascii.encode(language));
        final languageInput = _copyInput(languageBytes);
        allocations.add(languageInput);
        entry.ref.languageData = languageInput;
        entry.ref.languageLen = languageBytes.length;
      }
    }
    return faces;
  }

  RitoArtifact requestArtifactEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    final owned = _requestArtifactEncodedWire(
      sessionId: sessionId,
      requestBytes: requestBytes,
    );
    try {
      final artifact = artifactDecoder.decode(owned);
      _validateArtifactIdentity(
        artifact,
        sessionId: sessionId,
        requestId: _acceptedRequestId(requestBytes),
      );
      return artifact;
    } on Object catch (error, stackTrace) {
      if (_releaseAfterFailedArtifact(sessionId, _acceptedArtifactId(owned))) {
        rethrow;
      }
      _disposeAfterFailedSessionOutput(sessionId);
      Error.throwWithStackTrace(
        _terminatedSessionResultError('artifact', error),
        stackTrace,
      );
    }
  }

  Uint8List _requestArtifactEncodedWire({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    _validateId(sessionId, 'session id');
    _validateInput(requestBytes, 16 * 1024 * 1024, 'request');
    final request = _copyInput(requestBytes);
    final artifactOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _requestArtifact(
        sessionId,
        request,
        requestBytes.length,
        artifactOut,
        errorOut,
      );
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(artifactOut, 'artifact');
      } on Object catch (error, stackTrace) {
        _disposeAfterFailedSessionOutput(sessionId);
        Error.throwWithStackTrace(
          _terminatedSessionResultError('artifact', error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(artifactOut);
      _bufferFree(errorOut);
      calloc
        ..free(artifactOut)
        ..free(errorOut)
        ..free(request);
    }
  }

  RitoArtifact requestAdjacentEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    final owned = _requestAdjacentEncodedWire(
      sessionId: sessionId,
      requestBytes: requestBytes,
    );
    try {
      final artifact = artifactDecoder.decode(owned);
      _validateArtifactIdentity(
        artifact,
        sessionId: sessionId,
        requestId: _acceptedRequestId(requestBytes),
      );
      return artifact;
    } on Object catch (error, stackTrace) {
      if (_releaseAfterFailedArtifact(sessionId, _acceptedArtifactId(owned))) {
        rethrow;
      }
      _disposeAfterFailedSessionOutput(sessionId);
      Error.throwWithStackTrace(
        _terminatedSessionResultError('adjacent artifact', error),
        stackTrace,
      );
    }
  }

  Uint8List _requestAdjacentEncodedWire({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    _validateId(sessionId, 'session id');
    if (requestBytes.length != 60) {
      throw ArgumentError.value(
        requestBytes.length,
        'request byte length',
        'RITONAV1 must be exactly 60 bytes',
      );
    }
    final request = _copyInput(requestBytes);
    final artifactOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _requestAdjacent(
        sessionId,
        request,
        requestBytes.length,
        artifactOut,
        errorOut,
      );
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(artifactOut, 'artifact');
      } on Object catch (error, stackTrace) {
        _disposeAfterFailedSessionOutput(sessionId);
        Error.throwWithStackTrace(
          _terminatedSessionResultError('adjacent artifact', error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(artifactOut);
      _bufferFree(errorOut);
      calloc
        ..free(artifactOut)
        ..free(errorOut)
        ..free(request);
    }
  }

  RitoArtifact peekAdjacentEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    final owned = _peekAdjacentEncodedWire(
      sessionId: sessionId,
      requestBytes: requestBytes,
    );
    try {
      final artifact = artifactDecoder.decode(owned);
      _validateArtifactIdentity(
        artifact,
        sessionId: sessionId,
        requestId: _acceptedRequestId(requestBytes),
      );
      return artifact;
    } on Object catch (error, stackTrace) {
      if (_releaseAfterFailedArtifact(sessionId, _acceptedArtifactId(owned))) {
        rethrow;
      }
      _disposeAfterFailedSessionOutput(sessionId);
      Error.throwWithStackTrace(
        _terminatedSessionResultError('peeked artifact', error),
        stackTrace,
      );
    }
  }

  Uint8List _peekAdjacentEncodedWire({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    _validateId(sessionId, 'session id');
    if (requestBytes.length != 60) {
      throw ArgumentError.value(
        requestBytes.length,
        'request byte length',
        'RITONAV1 must be exactly 60 bytes',
      );
    }
    final request = _copyInput(requestBytes);
    final artifactOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _peekAdjacent(
        sessionId,
        request,
        requestBytes.length,
        artifactOut,
        errorOut,
      );
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(artifactOut, 'artifact');
      } on Object catch (error, stackTrace) {
        _disposeAfterFailedSessionOutput(sessionId);
        Error.throwWithStackTrace(
          _terminatedSessionResultError('peeked artifact', error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(artifactOut);
      _bufferFree(errorOut);
      calloc
        ..free(artifactOut)
        ..free(errorOut)
        ..free(request);
    }
  }

  Uint8List commitPeekedArtifactEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    return _ownedWireRequest(
      sessionId: sessionId,
      requestBytes: requestBytes,
      expectedLength: 48,
      wireName: 'RITOFGH1',
      outputName: 'peeked commit acknowledgement',
      operation: _commitPeeked,
    );
  }

  Uint8List readPublicationEncoded({required int sessionId}) {
    _validateId(sessionId, 'session id');
    final publicationOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _readPublication(sessionId, publicationOut, errorOut);
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(publicationOut, 'publication');
      } on Object catch (error, stackTrace) {
        _disposeAfterFailedSessionOutput(sessionId);
        Error.throwWithStackTrace(
          _terminatedSessionResultError('publication', error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(publicationOut);
      _bufferFree(errorOut);
      calloc
        ..free(publicationOut)
        ..free(errorOut);
    }
  }

  Uint8List adoptForegroundCandidateEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    return _ownedWireRequest(
      sessionId: sessionId,
      requestBytes: requestBytes,
      expectedLength: 48,
      wireName: 'RITOFGH1',
      outputName: 'foreground handoff acknowledgement',
      operation: _adoptForeground,
    );
  }

  Uint8List advanceBackgroundEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    return _ownedWireRequest(
      sessionId: sessionId,
      requestBytes: requestBytes,
      expectedLength: 40,
      wireName: 'RITOBGQ1',
      outputName: 'background advance',
      operation: _advanceBackground,
    );
  }

  Uint8List adoptBackgroundCandidateEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) {
    return _ownedWireRequest(
      sessionId: sessionId,
      requestBytes: requestBytes,
      expectedLength: 44,
      wireName: 'RITOHOF1',
      outputName: 'background handoff acknowledgement',
      operation: _adoptBackground,
    );
  }

  Uint8List _ownedWireRequest({
    required int sessionId,
    required Uint8List requestBytes,
    required int expectedLength,
    required String wireName,
    required String outputName,
    required _OwnedWireRequestDart operation,
  }) {
    _validateId(sessionId, 'session id');
    if (requestBytes.length != expectedLength) {
      throw ArgumentError.value(
        requestBytes.length,
        'request byte length',
        '$wireName must be exactly $expectedLength bytes',
      );
    }
    final request = _copyInput(requestBytes);
    final output = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = operation(
        sessionId,
        request,
        requestBytes.length,
        output,
        errorOut,
      );
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      try {
        return _copyOutput(output, outputName);
      } on Object catch (error, stackTrace) {
        _disposeAfterFailedSessionOutput(sessionId);
        Error.throwWithStackTrace(
          _terminatedSessionResultError(outputName, error),
          stackTrace,
        );
      }
    } finally {
      _bufferFree(output);
      _bufferFree(errorOut);
      calloc
        ..free(output)
        ..free(errorOut)
        ..free(request);
    }
  }

  RitoResource readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) {
    final owned = _readResourceWire(
      sessionId: sessionId,
      artifactId: artifactId,
      kind: kind,
      href: href,
    );
    try {
      final resource = resourceDecoder.decode(owned);
      if (resource.artifactId != artifactId ||
          resource.kind != kind ||
          resource.href != href) {
        throw const RitoNativeException(
          status: 4,
          message: 'Native resource identity does not match its request.',
        );
      }
      return resource;
    } on Object catch (error, stackTrace) {
      _disposeAfterFailedSessionOutput(sessionId);
      Error.throwWithStackTrace(
        _terminatedSessionResultError('resource', error),
        stackTrace,
      );
    }
  }

  Uint8List _readResourceWire({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) {
    _validateId(sessionId, 'session id');
    _validateId(artifactId, 'artifact id');
    final hrefBytes = Uint8List.fromList(utf8.encode(href));
    if (hrefBytes.isEmpty || hrefBytes.length > ritoMaxStringBytes) {
      throw ArgumentError.value(
        href,
        'href',
        'must be non-empty protocol UTF-8',
      );
    }
    final hrefInput = _copyInput(hrefBytes);
    final resourceOut = calloc<_RitoOwnedBuffer>();
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _readResource(
        sessionId,
        artifactId,
        _resourceKindTag(kind),
        hrefInput,
        hrefBytes.length,
        resourceOut,
        errorOut,
      );
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
      return _copyOutput(resourceOut, 'resource');
    } finally {
      _bufferFree(resourceOut);
      _bufferFree(errorOut);
      calloc
        ..free(resourceOut)
        ..free(errorOut)
        ..free(hrefInput);
    }
  }

  void releaseArtifact({required int sessionId, required int artifactId}) {
    _validateId(sessionId, 'session id');
    _validateId(artifactId, 'artifact id');
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _release(sessionId, artifactId, errorOut);
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
    } finally {
      _bufferFree(errorOut);
      calloc.free(errorOut);
    }
  }

  void dispose({required int sessionId}) {
    _validateId(sessionId, 'session id');
    final errorOut = calloc<_RitoOwnedBuffer>();
    try {
      final status = _dispose(sessionId, errorOut);
      if (status != 0) {
        throw _nativeError(status, errorOut);
      }
    } finally {
      _bufferFree(errorOut);
      calloc.free(errorOut);
    }
  }

  Pointer<Uint8> _copyInput(Uint8List bytes) {
    if (bytes.isEmpty) {
      return nullptr;
    }
    final pointer = calloc<Uint8>(bytes.length);
    pointer.asTypedList(bytes.length).setAll(0, bytes);
    return pointer;
  }

  Uint8List _copyOutput(Pointer<_RitoOwnedBuffer> output, String field) {
    final length = output.ref.length;
    final capacity = output.ref.capacity;
    if (length < 0 || length > ritoMaxWireBytes || length > capacity) {
      throw RitoNativeException(
        status: 4,
        message: '$field buffer exceeds the Dart adapter limit',
      );
    }
    if (length == 0) {
      return Uint8List(0);
    }
    if (output.ref.data == nullptr) {
      throw RitoNativeException(
        status: 4,
        message: '$field buffer pointer is null',
      );
    }
    // Copy before rito_buffer_free_v1. No native pointer escapes this method.
    return Uint8List.fromList(output.ref.data.asTypedList(length));
  }

  RitoNativeException _nativeError(
    int status,
    Pointer<_RitoOwnedBuffer> errorOut,
  ) {
    final bytes = _copyOutput(errorOut, 'error');
    final message = bytes.isEmpty
        ? 'Rito native call failed without a diagnostic.'
        : utf8.decode(bytes, allowMalformed: false);
    return RitoNativeException(status: status, message: message);
  }

  RitoNativeException _terminatedSessionResultError(
    String outputName,
    Object error,
  ) {
    return RitoNativeException(
      status: ritoNativeStatusSessionTerminatedV1,
      message:
          'Native $outputName result could not be trusted; the session was '
          'terminated: $error',
    );
  }

  void _validateId(int value, String field) {
    if (value <= 0 || value > 0x7fffffffffffffff) {
      throw ArgumentError.value(value, field, 'must be a non-zero external ID');
    }
  }

  void _validateInput(Uint8List bytes, int limit, String field) {
    if (bytes.isEmpty || bytes.length > limit) {
      throw ArgumentError.value(
        bytes.length,
        '$field byte length',
        'must be between 1 and $limit',
      );
    }
  }

  int? _acceptedRequestSessionId(Uint8List requestBytes) {
    // Core returning success proves this was an accepted RITOREQ1 message.
    // The fixed header is 20 bytes and session_id is its first body field.
    if (requestBytes.length < 28) {
      return null;
    }
    final value = ByteData.sublistView(
      requestBytes,
      20,
      28,
    ).getUint64(0, Endian.little);
    return value > 0 && value <= 0x7fffffffffffffff ? value : null;
  }

  int? _acceptedRequestId(Uint8List requestBytes) {
    if (requestBytes.length < 36) {
      return null;
    }
    final value = ByteData.sublistView(
      requestBytes,
      28,
      36,
    ).getUint64(0, Endian.little);
    return value > 0 && value <= 0x7fffffffffffffff ? value : null;
  }

  void _validateArtifactIdentity(
    RitoArtifact artifact, {
    required int? sessionId,
    required int? requestId,
  }) {
    if (sessionId == null ||
        requestId == null ||
        artifact.sessionId != sessionId ||
        artifact.requestId != requestId) {
      throw const RitoNativeException(
        status: 4,
        message: 'Native artifact identity does not match its request.',
      );
    }
  }

  void _disposeAfterFailedSessionOutput(int? sessionId) {
    if (sessionId == null) {
      return;
    }
    Pointer<_RitoOwnedBuffer>? errorOut;
    try {
      errorOut = calloc<_RitoOwnedBuffer>();
      _dispose(sessionId, errorOut);
    } on Object {
      // Preserve the original malformed-artifact failure. This cleanup is the
      // last-resort path for an ABI implementation that already broke its
      // success contract.
    } finally {
      if (errorOut != null) {
        _bufferFree(errorOut);
        calloc.free(errorOut);
      }
    }
  }

  int? _acceptedArtifactId(Uint8List? artifactBytes) {
    // artifact_id follows the fixed header, protocol/profile, session,
    // request, revision and revision-version fields.
    if (artifactBytes == null || artifactBytes.length < 64) {
      return null;
    }
    final value = ByteData.sublistView(
      artifactBytes,
      56,
      64,
    ).getUint64(0, Endian.little);
    return value > 0 && value <= 0x7fffffffffffffff ? value : null;
  }

  bool _releaseAfterFailedArtifact(int sessionId, int? artifactId) {
    if (artifactId == null) {
      return false;
    }
    Pointer<_RitoOwnedBuffer>? errorOut;
    try {
      errorOut = calloc<_RitoOwnedBuffer>();
      return _release(sessionId, artifactId, errorOut) == 0;
    } on Object {
      // Keep the decoder contract failure as the primary diagnostic.
      return false;
    } finally {
      if (errorOut != null) {
        _bufferFree(errorOut);
        calloc.free(errorOut);
      }
    }
  }

  int _resourceKindTag(RitoResourceKind kind) {
    return switch (kind) {
      RitoResourceKind.image => 0,
      RitoResourceKind.font => 1,
      RitoResourceKind.stylesheet => 2,
    };
  }
}

/// Raw typed-wire access used only by the isolate transport.
///
/// This class deliberately is not exported from the package entrypoints. The
/// receiving isolate must decode and validate every returned RITOART1 or
/// RITORES1 message before exposing it to callers.
final class RitoNativeWireBindings {
  RitoNativeWireBindings() : _bindings = RitoNativeBindings();

  RitoNativeWireBindings.fromDynamicLibrary(DynamicLibrary library)
    : _bindings = RitoNativeBindings.fromDynamicLibrary(library);

  final RitoNativeBindings _bindings;

  Uint8List openEncoded({
    required Uint8List publicationBytes,
    required Uint8List requestBytes,
    RitoPinnedFontPolicy? pinnedFontPolicy,
  }) => _bindings._openEncodedWire(
    publicationBytes: publicationBytes,
    requestBytes: requestBytes,
    pinnedFontPolicy: pinnedFontPolicy,
  );

  Uint8List requestArtifactEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings._requestArtifactEncodedWire(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List requestAdjacentEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings._requestAdjacentEncodedWire(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List peekAdjacentEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings._peekAdjacentEncodedWire(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List commitPeekedArtifactEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings.commitPeekedArtifactEncoded(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List readPublicationEncoded({required int sessionId}) =>
      _bindings.readPublicationEncoded(sessionId: sessionId);

  Uint8List adoptForegroundCandidateEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings.adoptForegroundCandidateEncoded(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List advanceBackgroundEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings.advanceBackgroundEncoded(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List adoptBackgroundCandidateEncoded({
    required int sessionId,
    required Uint8List requestBytes,
  }) => _bindings.adoptBackgroundCandidateEncoded(
    sessionId: sessionId,
    requestBytes: requestBytes,
  );

  Uint8List readResource({
    required int sessionId,
    required int artifactId,
    required RitoResourceKind kind,
    required String href,
  }) => _bindings._readResourceWire(
    sessionId: sessionId,
    artifactId: artifactId,
    kind: kind,
    href: href,
  );

  void releaseArtifact({required int sessionId, required int artifactId}) {
    _bindings.releaseArtifact(sessionId: sessionId, artifactId: artifactId);
  }

  void dispose({required int sessionId}) {
    _bindings.dispose(sessionId: sessionId);
  }
}
