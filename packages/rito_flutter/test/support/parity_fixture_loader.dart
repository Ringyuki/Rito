// The synthetic images both pens share and the CSS colour parser the
// parity render test reads fixture backgrounds and themes with. Keep the
// synthetic pixel definitions byte-identical with harness/entry.ts.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:rito_flutter/rito_flutter_protocol.dart';

RitoColor parseCssColor(String css) {
  final text = css.trim();
  if (text.startsWith('#')) {
    return _hexColor(text);
  }
  if (text.startsWith('rgb')) {
    final inner = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    final parts = inner
        .split(RegExp(r'[,\s/]+'))
        .where((p) => p.isNotEmpty)
        .toList();
    return _srgb(
      double.parse(parts[0]) / 255,
      double.parse(parts[1]) / 255,
      double.parse(parts[2]) / 255,
      parts.length > 3 ? double.parse(parts[3]) : 1,
    );
  }
  if (text.startsWith('color(display-p3')) {
    final inner = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    final parts = inner
        .split(RegExp(r'[\s/]+'))
        .where((p) => p.isNotEmpty)
        .skip(1)
        .toList();
    return RitoColor(
      space: RitoColorSpace.displayP3,
      component0: double.parse(parts[0]),
      component1: double.parse(parts[1]),
      component2: double.parse(parts[2]),
      alpha: parts.length > 3 ? double.parse(parts[3]) : 1,
      none: const RitoColorNoneFlags(
        component0: false,
        component1: false,
        component2: false,
        alpha: false,
      ),
    );
  }
  throw FormatException('unsupported parity color: $css');
}

RitoColor _hexColor(String hex) {
  final digits = hex.substring(1);
  final expanded = digits.length == 3
      ? digits.split('').map((d) => '$d$d').join()
      : digits;
  final value = int.parse(expanded.padRight(8, 'f'), radix: 16);
  return _srgb(
    ((value >> 24) & 0xff) / 255,
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

RitoColor _srgb(double r, double g, double b, double a) {
  return RitoColor(
    space: RitoColorSpace.srgb,
    component0: r,
    component1: g,
    component2: b,
    alpha: a,
    none: const RitoColorNoneFlags(
      component0: false,
      component1: false,
      component2: false,
      alpha: false,
    ),
  );
}

/// Synthetic image sources — must stay byte-identical with
/// harness/entry.ts `syntheticPixels`.
Future<ui.Image?> makeSyntheticImage(String src) async {
  final pixels = _syntheticPixels(src);
  if (pixels == null) return null;
  final completer = Completer<ui.Image>();
  ui.decodeImageFromPixels(
    pixels.rgba,
    pixels.width,
    pixels.height,
    ui.PixelFormat.rgba8888,
    completer.complete,
  );
  return completer.future;
}

final class _SyntheticPixels {
  _SyntheticPixels(this.width, this.height, this.rgba);

  final int width;
  final int height;
  final Uint8List rgba;
}

_SyntheticPixels? _syntheticPixels(String src) {
  if (src == 'synthetic:checker16') {
    return _fillPixels(16, 16, (x, y) {
      return ((x >> 2) + (y >> 2)) % 2 == 0
          ? const [255, 0, 0, 255]
          : const [0, 0, 255, 255];
    });
  }
  if (src == 'synthetic:gradient32') {
    return _fillPixels(32, 32, (x, y) {
      final r = (x * 255) ~/ 31;
      return [r, (y * 255) ~/ 31, 255 - r, 255];
    });
  }
  if (src == 'synthetic:dot8') {
    return _fillPixels(8, 8, (x, y) {
      return x >= 3 && x <= 4 && y >= 3 && y <= 4
          ? const [0, 0, 0, 255]
          : const [255, 255, 255, 255];
    });
  }
  return null;
}

_SyntheticPixels _fillPixels(
  int width,
  int height,
  List<int> Function(int x, int y) pixel,
) {
  final rgba = Uint8List(width * height * 4);
  for (var y = 0; y < height; y += 1) {
    for (var x = 0; x < width; x += 1) {
      final p = pixel(x, y);
      final offset = (y * width + x) * 4;
      rgba[offset] = p[0];
      rgba[offset + 1] = p[1];
      rgba[offset + 2] = p[2];
      rgba[offset + 3] = p[3];
    }
  }
  return _SyntheticPixels(width, height, rgba);
}
