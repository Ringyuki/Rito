part of 'canvas_target.dart';

// A shadow's exclusion clip is the whole plane less the excluded shape;
// this reach stands in for the plane on any page a reader can lay out.
const double _clipReach = 1048576;

/// Blits the device-resolved primitive list onto a Flutter canvas.
///
/// The canvas is expected in device pixels with an identity transform:
/// every coordinate lands on the device grid as the engine resolved it,
/// nothing here measures or snaps. Text runs and pass-through blocks go
/// to the semantic painter with their lengths already in device pixels,
/// and the theme override's ground tracking is shared with it.
final class RitoPrimitiveCanvasTarget implements RitoPrimitiveTarget {
  RitoPrimitiveCanvasTarget(
    ui.Canvas canvas, {
    required RitoImageResolver resolveImage,
    RitoFontEnvelopeStore? fontEnvelopes,
    RitoCanvasColorOverride? colorOverride,
  }) : _semantic = RitoCanvasPaintTarget(
         canvas,
         resolveImage: resolveImage,
         fontEnvelopes: fontEnvelopes,
         colorOverride: colorOverride,
       );

  final RitoCanvasPaintTarget _semantic;

  ui.Canvas get _canvas => _semantic._canvas;

  @override
  void save() => _semantic.save();

  @override
  void restore() => _semantic.restore();

  @override
  void translate(RitoPrimitiveTranslate primitive) {
    _canvas.translate(primitive.dx, primitive.dy);
  }

  @override
  void opacity(RitoPrimitiveOpacity primitive) {
    _semantic.opacity(RitoOpacity(primitive.value));
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
      _canvas.clipRect(_semantic._rect(rect));
      return;
    }
    _canvas.clipPath(_devicePath(primitive.path));
  }

  /// A fill declaring the page ground resets the declared grounds and
  /// takes the theme's R1 decision: a designed ground (opaque, darker than
  /// the white-paper limit) stays the book's and marks the page
  /// book-owned; a near-white ground is the typesetter's paper default and
  /// the theme paints its own. A fill declaring a block ground is recorded
  /// for the ink typeset over it (the engine only declares opaque ones).
  @override
  void fillRect(RitoPrimitiveFillRect primitive) {
    final rect = _semantic._rect(primitive.rect);
    var fill = _semantic._color(primitive.color);
    if (identical(primitive.ground, RitoFillGround.page)) {
      _semantic._blockGrounds.clear();
      _semantic._bookOwnedPageGround = null;
      final override = _semantic._colorOverride;
      if (override != null) {
        final book = ritoUiColor(primitive.color);
        if (RitoCanvasColorOverride.isBookOwnedPageGround(book)) {
          _semantic._bookOwnedPageGround = book;
        } else {
          fill = override.background.withValues(
            alpha: override.background.a * _semantic._opacity,
          );
        }
      }
    } else if (identical(primitive.ground, RitoFillGround.block)) {
      _semantic._blockGrounds.add((
        rect: rect,
        color: ritoUiColor(primitive.color),
      ));
    }
    _canvas.drawRect(rect, ui.Paint()..color = fill);
  }

  @override
  void fillPath(RitoPrimitiveFillPath primitive) {
    final path = _devicePath(primitive.path)
      ..fillType = identical(primitive.rule, RitoFillRule.evenOdd)
          ? ui.PathFillType.evenOdd
          : ui.PathFillType.nonZero;
    _canvas.drawPath(
      path,
      ui.Paint()..color = _semantic._color(primitive.color),
    );
  }

  @override
  void strokePath(RitoPrimitiveStrokePath primitive) {
    final paint = ui.Paint()
      ..style = ui.PaintingStyle.stroke
      ..color = _semantic._color(primitive.color)
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
      final color = _semantic._color(primitive.color);
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
    final image = _semantic._preparedImages.containsKey(primitive.src)
        ? _semantic._preparedImages[primitive.src]
        : _semantic._resolveImage(primitive.src);
    if (image == null) {
      return;
    }
    final sourceRect = primitive.sourceRect;
    final source = sourceRect == null
        ? ui.Rect.fromLTWH(
            0,
            0,
            image.width.toDouble(),
            image.height.toDouble(),
          )
        : _semantic._rect(sourceRect);
    final dest = _semantic._rect(primitive.dest);
    final paint = _semantic._imagePaint();
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
  void text(RitoPrimitiveText primitive) =>
      _semantic.paintText(primitive.command);

  @override
  void ruby(RitoPrimitiveRuby primitive) =>
      _semantic.paintRuby(primitive.command);

  @override
  void block(RitoPrimitiveBlock primitive) =>
      _semantic.paintBlock(primitive.command);

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
          built.addRect(_semantic._rect(rect));
        case RitoPathClose():
          built.close();
      }
    }
    return built;
  }
}
