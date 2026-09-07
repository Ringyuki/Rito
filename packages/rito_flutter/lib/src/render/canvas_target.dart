import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../protocol/display_color.dart';
import '../protocol/display_geometry.dart';
import '../protocol/display_models.dart';
import '../protocol/display_paint.dart';
import '../protocol/primitive_models.dart';
import '../protocol/wire_exception.dart';
import 'color_override.dart';
import 'font_envelope.dart';
import 'font_family_stack.dart';
import 'primitive_replayer.dart';
import 'resources.dart';
import 'typed_color.dart';

part 'canvas_target_text.dart';

// A shadow's exclusion clip is the whole plane less the excluded shape;
// this reach stands in for the plane on any page a reader can lay out.
const double _clipReach = 1048576;

/// Blits the device-resolved `RITODL1` primitive list onto a Flutter
/// canvas.
///
/// The canvas is expected in device pixels with an identity transform:
/// every coordinate lands on the device grid as the engine resolved it,
/// nothing here measures or snaps. Text runs are the one exception the
/// engine still leaves to the host: they arrive in CSS pixels and paint
/// under `scale(ratio)`, because glyph rasterization follows the CSS
/// font size (a synthetic-bold run widens with the size it is asked for,
/// and the device size on the device grid rasters different ink from the
/// browser's). The theme override's ground tracking is shared between
/// fills and that text painter.
final class RitoPrimitiveCanvasTarget implements RitoPrimitiveTarget {
  RitoPrimitiveCanvasTarget(
    this._canvas, {
    required RitoImageResolver resolveImage,
    RitoFontEnvelopeStore? fontEnvelopes,
    RitoCanvasColorOverride? colorOverride,
    double ratio = 1,
  }) : _resolveImage = resolveImage,
       _fontEnvelopes = fontEnvelopes,
       _colorOverride = colorOverride,
       _ratio = ratio {
    if (!ratio.isFinite || ratio <= 0) {
      throw ArgumentError.value(ratio, 'ratio', 'must be finite and positive');
    }
  }

  final ui.Canvas _canvas;
  final RitoImageResolver _resolveImage;

  /// Device pixels per CSS pixel the list was resolved at; text runs
  /// paint under it.
  final double _ratio;
  final RitoFontEnvelopeStore? _fontEnvelopes;
  final RitoCanvasColorOverride? _colorOverride;
  final List<double> _opacityStack = <double>[1];

  /// Laid-out cluster paragraphs by (text, family, size, weight, italic,
  /// colour), reused across paints of the same target.
  final Map<(String, String, double, double, bool, int), ui.Paragraph>
  _clusterParagraphs =
      <(String, String, double, double, bool, int), ui.Paragraph>{};
  // Declared-ground tracking for the theme override (R1/R2): opaque
  // block grounds replayed so far, and the page ground when R1 kept the
  // book's own color. Reset by every page ground. The browser pen
  // accumulates and searches these the same way or parity drifts.
  final List<({ui.Rect rect, ui.Color color})> _blockGrounds =
      <({ui.Rect rect, ui.Color color})>[];
  ui.Color? _bookOwnedPageGround;

  double get _opacity => _opacityStack.last;

  @override
  void save() {
    _canvas.save();
    _opacityStack.add(_opacity);
  }

  @override
  void restore() {
    if (_opacityStack.length == 1) {
      throw const RitoWireException('restore has no matching save');
    }
    _canvas.restore();
    _opacityStack.removeLast();
  }

  @override
  void translate(RitoPrimitiveTranslate primitive) {
    _canvas.translate(primitive.dx, primitive.dy);
  }

  @override
  void opacity(RitoPrimitiveOpacity primitive) {
    if (primitive.value < 0 || primitive.value > 1) {
      throw const RitoWireException('opacity must be between zero and one');
    }
    _opacityStack[_opacityStack.length - 1] = _opacity * primitive.value;
  }

  @override
  void transform(RitoPrimitiveTransform primitive) {
    _canvas.translate(primitive.origin.x, primitive.origin.y);
    for (final transform in primitive.transforms) {
      switch (transform) {
        case RitoDeviceRotate(:final radians):
          _canvas.rotate(radians);
        case RitoDeviceScale(:final sx, :final sy):
          _canvas.scale(sx, sy);
        case RitoDeviceTranslate(:final dx, :final dy):
          _canvas.translate(dx, dy);
      }
    }
    _canvas.translate(-primitive.origin.x, -primitive.origin.y);
  }

  @override
  void clipPath(RitoPrimitiveClipPath primitive) {
    if (primitive.path.ops case [RitoPathRect(:final rect)]) {
      _canvas.clipRect(_rect(rect));
      return;
    }
    _canvas.clipPath(_devicePath(primitive.path));
  }

  @override
  void fillRect(RitoPrimitiveFillRect primitive) {
    _canvas.drawRect(
      _rect(primitive.rect),
      ui.Paint()
        ..color = _declareGround(
          primitive.ground,
          primitive.groundRect,
          primitive.color,
        ),
    );
  }

  @override
  void fillPath(RitoPrimitiveFillPath primitive) {
    final path = _devicePath(primitive.path)
      ..fillType = identical(primitive.rule, RitoFillRule.evenOdd)
          ? ui.PathFillType.evenOdd
          : ui.PathFillType.nonZero;
    _canvas.drawPath(
      path,
      ui.Paint()
        ..color = _declareGround(
          primitive.ground,
          primitive.groundRect,
          primitive.color,
        ),
    );
  }

  /// The colour a fill paints, after its declared ground is taken in. A
  /// fill declaring the page ground resets the declared grounds and takes
  /// the theme's R1 decision: a designed ground (opaque, darker than the
  /// white-paper limit) stays the book's and marks the page book-owned; a
  /// near-white ground is the typesetter's paper default and the theme
  /// paints its own. A fill declaring a block ground records the unsnapped
  /// box it covers for the ink typeset over it (the engine only declares
  /// opaque ones).
  ui.Color _declareGround(
    RitoFillGround ground,
    RitoDisplayRect? groundRect,
    RitoColor color,
  ) {
    final fill = _color(color);
    if (identical(ground, RitoFillGround.page)) {
      _blockGrounds.clear();
      _bookOwnedPageGround = null;
      final override = _colorOverride;
      if (override != null) {
        final book = ritoUiColor(color);
        if (RitoCanvasColorOverride.isBookOwnedPageGround(book)) {
          _bookOwnedPageGround = book;
        } else {
          return override.background.withValues(
            alpha: override.background.a * _opacity,
          );
        }
      }
    } else if (identical(ground, RitoFillGround.block) && groundRect != null) {
      _blockGrounds.add((rect: _rect(groundRect), color: ritoUiColor(color)));
    }
    return fill;
  }

  @override
  void strokePath(RitoPrimitiveStrokePath primitive) {
    final paint = ui.Paint()
      ..style = ui.PaintingStyle.stroke
      ..color = _color(primitive.color)
      ..strokeWidth = primitive.width
      ..strokeCap = identical(primitive.cap, RitoStrokeCap.round)
          ? ui.StrokeCap.round
          : ui.StrokeCap.butt;
    final path = _devicePath(primitive.path);
    final dash = primitive.dash;
    if (dash == null) {
      _canvas.drawPath(path, paint);
      return;
    }
    for (final metric in path.computeMetrics()) {
      for (
        var cursor = 0.0;
        cursor < metric.length;
        cursor += dash.on + dash.off
      ) {
        _canvas.drawPath(
          metric.extractPath(cursor, math.min(metric.length, cursor + dash.on)),
          paint,
        );
      }
    }
  }

  @override
  void shadow(RitoPrimitiveShadow primitive) {
    _canvas.save();
    try {
      final clipOut = primitive.clipOut;
      if (clipOut != null) {
        final clip = ui.Path()
          ..fillType = ui.PathFillType.evenOdd
          ..addRect(
            const ui.Rect.fromLTWH(
              -_clipReach,
              -_clipReach,
              2 * _clipReach,
              2 * _clipReach,
            ),
          )
          ..addPath(_devicePath(clipOut), ui.Offset.zero);
        _canvas.clipPath(clip);
      }
      final shape = _devicePath(primitive.shape);
      final color = _color(primitive.color);
      final blurred = ui.Paint()..color = color;
      if (primitive.sigma > 0) {
        blurred.maskFilter = ui.MaskFilter.blur(
          ui.BlurStyle.normal,
          primitive.sigma,
        );
      }
      _canvas.drawPath(
        shape.shift(ui.Offset(primitive.offset.x, primitive.offset.y)),
        blurred,
      );
      _canvas.drawPath(shape, ui.Paint()..color = color);
    } finally {
      _canvas.restore();
    }
  }

  @override
  void drawImage(RitoPrimitiveDrawImage primitive) {
    final image = _resolveImage(primitive.src);
    if (image == null) {
      return;
    }
    // A sourceRect samples only that raster region — the clamp-bleed
    // strip an svg letterbox smears across its sliver (browser pen's
    // 9-argument drawImage).
    final sourceRect = primitive.sourceRect;
    final source = sourceRect == null
        ? ui.Rect.fromLTWH(
            0,
            0,
            image.width.toDouble(),
            image.height.toDouble(),
          )
        : _rect(sourceRect);
    final dest = _rect(primitive.dest);
    final paint = _imagePaint();
    final tiles = primitive.tiles;
    if (tiles == null) {
      _canvas.drawImageRect(image, source, dest, paint);
      return;
    }
    for (var row = 0; row < tiles.rows; row += 1) {
      for (var column = 0; column < tiles.columns; column += 1) {
        _canvas.drawImageRect(
          image,
          source,
          ui.Rect.fromLTWH(
            tiles.origin.x + column * tiles.stepX,
            tiles.origin.y + row * tiles.stepY,
            dest.width,
            dest.height,
          ),
          paint,
        );
      }
    }
  }

  @override
  void text(RitoPrimitiveText primitive) => paintText(primitive.command);

  @override
  void ruby(RitoPrimitiveRuby primitive) => paintRuby(primitive.command);

  /// Paints one text run; the primitive replayer routes text primitives
  /// here and hosts may paint a run directly. The run is in CSS pixels
  /// and paints under the list's ratio.
  void paintText(RitoPaintText command) =>
      _underRatio(() => _paintText(command));

  /// Paints one ruby run.
  void paintRuby(RitoPaintRuby command) =>
      _underRatio(() => _paintRuby(command));

  void _underRatio(void Function() paint) {
    if (_ratio == 1) {
      paint();
      return;
    }
    _canvas.save();
    try {
      _canvas.scale(_ratio, _ratio);
      paint();
    } finally {
      _canvas.restore();
    }
  }

  ui.Path _devicePath(RitoDevicePath path) {
    final built = ui.Path();
    for (final op in path.ops) {
      switch (op) {
        case RitoPathMoveTo(:final x, :final y):
          built.moveTo(x, y);
        case RitoPathLineTo(:final x, :final y):
          built.lineTo(x, y);
        case RitoPathArc(
          :final cx,
          :final cy,
          :final rx,
          :final ry,
          :final start,
          :final sweep,
        ):
          built.arcTo(
            ui.Rect.fromCenter(
              center: ui.Offset(cx, cy),
              width: 2 * rx,
              height: 2 * ry,
            ),
            start,
            sweep,
            false,
          );
        case RitoPathEllipse(:final cx, :final cy, :final rx, :final ry):
          built.addOval(
            ui.Rect.fromCenter(
              center: ui.Offset(cx, cy),
              width: 2 * rx,
              height: 2 * ry,
            ),
          );
        case RitoPathRect(:final rect):
          built.addRect(_rect(rect));
        case RitoPathClose():
          built.close();
      }
    }
    return built;
  }

  ui.Rect _rect(RitoDisplayRect rect) {
    return ui.Rect.fromLTWH(rect.x, rect.y, rect.width, rect.height);
  }

  ui.Color _color(RitoColor source) {
    final color = ritoUiColor(source);
    return color.withValues(alpha: color.a * _opacity);
  }

  ui.Paint _imagePaint() {
    // Canvas 2D's default smoothing quality is 'low' — plain bilinear,
    // no mipmaps — so 'medium' would diverge on every downscale.
    return ui.Paint()
      ..filterQuality = ui.FilterQuality.low
      ..color = const ui.Color(0xffffffff).withValues(alpha: _opacity);
  }
}
