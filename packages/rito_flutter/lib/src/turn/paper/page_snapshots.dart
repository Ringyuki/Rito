import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter_gpu/gpu.dart' as gpu;

/// The pages as the GPU samples them: one texture for each page image,
/// read back from the image and uploaded once. An image is never painted
/// again, so a texture is good for as long as anything shows its page.
/// Reading an image back takes a while; until a texture is [ready] the
/// turn that needs it is drawn plain.
final class PaperPageSnapshots {
  PaperPageSnapshots({required this.onReady});

  /// Called when a texture asked for has been made.
  final VoidCallback onReady;

  final _made = Expando<gpu.Texture>();
  final _making = Expando<bool>();

  /// The texture of [image], or null while it is being made.
  gpu.Texture? ready(ui.Image image) => _made[image];

  /// Starts making the texture of [image], if it has not been.
  void warm(ui.Image image) {
    if (_made[image] != null || _making[image] == true) return;
    _making[image] = true;
    // The image may be let go by its slot while it is read back.
    final copy = image.clone();
    unawaited(
      copy
          .toByteData(format: ui.ImageByteFormat.rawRgba)
          .then((bytes) {
            if (bytes == null) return;
            final texture = gpu.gpuContext.createTexture(
              gpu.StorageMode.hostVisible,
              copy.width,
              copy.height,
            );
            texture.overwrite(bytes);
            _made[image] = texture;
            onReady();
          })
          .catchError((Object error, StackTrace stack) {
            FlutterError.reportError(
              FlutterErrorDetails(
                exception: error,
                stack: stack,
                library: 'rito_flutter',
                context: ErrorDescription('copying a page for the paper turn'),
              ),
            );
          })
          .whenComplete(() {
            _making[image] = null;
            copy.dispose();
          }),
    );
  }
}
