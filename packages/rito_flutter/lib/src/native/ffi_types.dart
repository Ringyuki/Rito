part of 'bindings.dart';

final class _RitoOwnedBuffer extends Struct {
  external Pointer<Uint8> data;

  @Uint64()
  external int length;

  @Uint64()
  external int capacity;
}

typedef _OpenNative =
    Uint32 Function(
      Pointer<Uint8>,
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _OpenDart =
    int Function(
      Pointer<Uint8>,
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );

/// Mirrors `RitoPinnedFontFaceV1` in the native ABI: face bytes, a
/// 64-hex-byte SHA-256, a generic-role tag, and an optional language
/// tag. All pointers stay owned by the Dart caller; the native side
/// copies before returning.
final class _RitoPinnedFontFace extends Struct {
  external Pointer<Uint8> bytesData;

  @Uint64()
  external int bytesLen;

  @Array(64)
  external Array<Uint8> sha256Hex;

  @Uint32()
  external int genericRole;

  external Pointer<Uint8> languageData;

  @Uint64()
  external int languageLen;
}

typedef _OpenWithPinnedFontsNative =
    Uint32 Function(
      Pointer<Uint8>,
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoPinnedFontFace>,
      Uint32,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _OpenWithPinnedFontsDart =
    int Function(
      Pointer<Uint8>,
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoPinnedFontFace>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _RequestArtifactNative =
    Uint32 Function(
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _RequestArtifactDart =
    int Function(
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _RequestAdjacentNative =
    Uint32 Function(
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _RequestAdjacentDart =
    int Function(
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadPublicationNative =
    Uint32 Function(
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadPublicationDart =
    int Function(int, Pointer<_RitoOwnedBuffer>, Pointer<_RitoOwnedBuffer>);
typedef _OwnedWireRequestNative =
    Uint32 Function(
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _OwnedWireRequestDart =
    int Function(
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadResourceNative =
    Uint32 Function(
      Uint64,
      Uint64,
      Uint32,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadResourceDart =
    int Function(
      int,
      int,
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadFootnoteNative =
    Uint32 Function(
      Uint64,
      Uint64,
      Pointer<Uint8>,
      Uint64,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReadFootnoteDart =
    int Function(
      int,
      int,
      Pointer<Uint8>,
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
typedef _ReleaseNative =
    Uint32 Function(Uint64, Uint64, Pointer<_RitoOwnedBuffer>);
typedef _ReleaseDart = int Function(int, int, Pointer<_RitoOwnedBuffer>);
typedef _DisposeNative = Uint32 Function(Uint64, Pointer<_RitoOwnedBuffer>);
typedef _DisposeDart = int Function(int, Pointer<_RitoOwnedBuffer>);
typedef _BufferFreeNative = Void Function(Pointer<_RitoOwnedBuffer>);
typedef _BufferFreeDart = void Function(Pointer<_RitoOwnedBuffer>);
