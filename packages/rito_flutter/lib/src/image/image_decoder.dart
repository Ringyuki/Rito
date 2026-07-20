import 'dart:typed_data';
import 'dart:ui' as ui;

/// Header-inspected encoded image whose full pixels have not been decoded.
abstract interface class RitoImageDecodeSource {
  int get width;
  int get height;

  /// Decodes no larger than the supplied, aspect-preserving target.
  Future<ui.Image> decode({
    required int targetWidth,
    required int targetHeight,
  });

  void dispose();
}

/// Injectable image header/decode boundary for platform-specific codecs.
abstract interface class RitoImageDecoder {
  Future<RitoImageDecodeSource> open({
    required Uint8List encodedBytes,
    required String mediaType,
  });
}

/// Flutter engine decoder used by the artifact image cache by default.
///
/// It inspects dimensions through [ui.ImageDescriptor] before instantiating a
/// codec, so policy can reject oversized sources without a full-size decode.
final class RitoUiImageDecoder implements RitoImageDecoder {
  const RitoUiImageDecoder();

  @override
  Future<RitoImageDecodeSource> open({
    required Uint8List encodedBytes,
    required String mediaType,
  }) async {
    if (!mediaType.toLowerCase().startsWith('image/')) {
      throw FormatException('Resource media type is not an image: $mediaType');
    }
    final buffer = await ui.ImmutableBuffer.fromUint8List(encodedBytes);
    try {
      final descriptor = await ui.ImageDescriptor.encoded(buffer);
      return _RitoUiImageDecodeSource(buffer, descriptor);
    } on Object {
      buffer.dispose();
      rethrow;
    }
  }
}

final class _RitoUiImageDecodeSource implements RitoImageDecodeSource {
  _RitoUiImageDecodeSource(this._buffer, this._descriptor);

  final ui.ImmutableBuffer _buffer;
  final ui.ImageDescriptor _descriptor;
  bool _disposed = false;

  @override
  int get width => _descriptor.width;

  @override
  int get height => _descriptor.height;

  @override
  Future<ui.Image> decode({
    required int targetWidth,
    required int targetHeight,
  }) async {
    if (_disposed) {
      throw StateError('Image decode source has been disposed.');
    }
    if (targetWidth <= 0 ||
        targetHeight <= 0 ||
        targetWidth > width ||
        targetHeight > height) {
      throw ArgumentError('Image decode target must be positive and bounded.');
    }
    final codec = width >= height
        ? await _descriptor.instantiateCodec(targetWidth: targetWidth)
        : await _descriptor.instantiateCodec(targetHeight: targetHeight);
    try {
      final frame = await codec.getNextFrame();
      final image = frame.image;
      if (image.width <= 0 ||
          image.height <= 0 ||
          image.width > targetWidth ||
          image.height > targetHeight) {
        image.dispose();
        throw const FormatException('Image codec exceeded its decode target.');
      }
      return image;
    } finally {
      codec.dispose();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    Object? firstError;
    StackTrace? firstStackTrace;
    try {
      _descriptor.dispose();
    } on Object catch (error, stackTrace) {
      firstError = error;
      firstStackTrace = stackTrace;
    }
    try {
      _buffer.dispose();
    } on Object catch (error, stackTrace) {
      firstError ??= error;
      firstStackTrace ??= stackTrace;
    }
    if (firstError != null) {
      Error.throwWithStackTrace(firstError, firstStackTrace!);
    }
  }
}
