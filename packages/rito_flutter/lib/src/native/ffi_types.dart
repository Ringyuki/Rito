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
    int Function(
      int,
      Pointer<_RitoOwnedBuffer>,
      Pointer<_RitoOwnedBuffer>,
    );
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
typedef _ReleaseNative =
    Uint32 Function(Uint64, Uint64, Pointer<_RitoOwnedBuffer>);
typedef _ReleaseDart = int Function(int, int, Pointer<_RitoOwnedBuffer>);
typedef _DisposeNative = Uint32 Function(Uint64, Pointer<_RitoOwnedBuffer>);
typedef _DisposeDart = int Function(int, Pointer<_RitoOwnedBuffer>);
typedef _BufferFreeNative = Void Function(Pointer<_RitoOwnedBuffer>);
typedef _BufferFreeDart = void Function(Pointer<_RitoOwnedBuffer>);
