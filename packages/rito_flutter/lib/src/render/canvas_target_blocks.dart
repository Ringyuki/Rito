part of 'canvas_target.dart';

extension _BlockPainting on RitoCanvasPaintTarget {
  void _paintPage(RitoPaintPage command) {
    final color = command.paint.backgroundColor;
    if (color != null) {
      _canvas.drawRect(_rect(command.rect), ui.Paint()..color = _color(color));
    }
  }

  void _paintBlock(RitoPaintBlock command) {
    final rect = _rect(command.rect);
    final radius = _blockRadius(command.paint.radius, rect);
    final prepared =
        _preparedBlocks[command] ?? _prepareBlockPaint(command, rect);
    // Per-corner radii shape only the background fill and clip; shadows
    // and borders see rx/ry 0, exactly like the browser pen's
    // resolveCanvasBlockRadius.
    _paintBoxShadows(rect, radius.uniform, command.paint.boxShadows);
    final background = command.paint.background;
    if (background != null) {
      _paintBlockBackground(
        rect,
        radius,
        background,
        prepared.image,
        prepared.tilePlan,
      );
    }
    _paintBlockBorders(
      rect,
      radius.uniform,
      command.paint.border,
      command.borderBox,
    );
  }

  _ResolvedBlockRadius _blockRadius(RitoBlockRadius? radius, ui.Rect rect) {
    return switch (radius) {
      null => const _ResolvedBlockRadius(ui.Radius.zero),
      RitoBlockPxRadius(:final value) => _ResolvedBlockRadius(
        ui.Radius.circular(value),
      ),
      RitoBlockPercentRadius(:final value) => _ResolvedBlockRadius(
        ui.Radius.elliptical(
          rect.width * value / 100,
          rect.height * value / 100,
        ),
      ),
      RitoBlockCornersRadius(:final corners) => _ResolvedBlockRadius(
        ui.Radius.zero,
        corners: corners,
      ),
    };
  }

  /// Rounded shape for a resolved radius: per-corner path when the
  /// corners disagree (overlap-scaled per CSS Backgrounds §5.5),
  /// uniform rounded rect otherwise.
  ui.RRect _resolvedRoundedRect(ui.Rect rect, _ResolvedBlockRadius radius) {
    final corners = radius.corners;
    if (corners == null) {
      return _roundedRect(rect, radius.uniform);
    }
    final scaled = _scaleCornerOverlap(corners, rect.width, rect.height);
    return ui.RRect.fromRectAndCorners(
      rect,
      topLeft: ui.Radius.circular(scaled[0]),
      topRight: ui.Radius.circular(scaled[1]),
      bottomRight: ui.Radius.circular(scaled[2]),
      bottomLeft: ui.Radius.circular(scaled[3]),
    );
  }

  /// CSS Backgrounds §5.5: shrink all corners by one factor so adjacent
  /// corners never cross on a short edge (browser pen
  /// scaleCornerOverlap).
  List<double> _scaleCornerOverlap(
    List<double> corners,
    double width,
    double height,
  ) {
    final tl = math.max(0.0, corners[0]);
    final tr = math.max(0.0, corners[1]);
    final br = math.max(0.0, corners[2]);
    final bl = math.max(0.0, corners[3]);
    double ratio(double extent, double sum) =>
        extent / math.max(1e-6, sum);
    final factor = math.min(
      1.0,
      math.min(
        math.min(ratio(width, tl + tr), ratio(width, bl + br)),
        math.min(ratio(height, tl + bl), ratio(height, tr + br)),
      ),
    );
    return <double>[tl * factor, tr * factor, br * factor, bl * factor];
  }

  /// Clockwise rounded-rect path with CSS radius clamping, the analogue
  /// of the browser pen's traceRoundedRect.
  ui.RRect _roundedRect(ui.Rect rect, ui.Radius radius) {
    final rx = math.min(radius.x, rect.width / 2);
    final ry = math.min(radius.y, rect.height / 2);
    return ui.RRect.fromRectXY(rect, math.max(0, rx), math.max(0, ry));
  }

  /// Outer box shadows per the browser pen: painted back-to-front, the
  /// box interior excluded with an even-odd clip, canvas shadowBlur
  /// being twice the Gaussian sigma, and the spread-expanded shape
  /// itself painted after its blurred copy (canvas composites the
  /// shadow beneath the shape it draws).
  void _paintBoxShadows(
    ui.Rect rect,
    ui.Radius radius,
    List<RitoBoxShadow> shadows,
  ) {
    for (final shadow in shadows.reversed) {
      if (shadow.inset) {
        continue;
      }
      _canvas.save();
      try {
        final padding =
            shadow.blur * 2 +
            shadow.offsetX.abs() +
            shadow.offsetY.abs() +
            math.max(shadow.spread, 0) +
            50;
        final clip = ui.Path()
          ..fillType = ui.PathFillType.evenOdd
          ..addRect(rect.inflate(padding))
          ..addRRect(_roundedRect(rect, radius));
        _canvas.clipPath(clip);

        final expanded = rect.inflate(shadow.spread);
        if (expanded.width <= 0 || expanded.height <= 0) {
          continue;
        }
        final expandedRadius = ui.Radius.elliptical(
          math.max(0, radius.x + shadow.spread),
          math.max(0, radius.y + shadow.spread),
        );
        final shape = _roundedRect(expanded, expandedRadius);
        final color = _color(shadow.color);
        final blurred = ui.Paint()..color = color;
        if (shadow.blur > 0) {
          blurred.maskFilter = ui.MaskFilter.blur(
            ui.BlurStyle.normal,
            shadow.blur / 2,
          );
        }
        _canvas.drawRRect(
          shape.shift(ui.Offset(shadow.offsetX, shadow.offsetY)),
          blurred,
        );
        _canvas.drawRRect(shape, ui.Paint()..color = color);
      } finally {
        _canvas.restore();
      }
    }
  }

  void _paintBlockBackground(
    ui.Rect rect,
    _ResolvedBlockRadius radius,
    RitoBackgroundPaint background,
    ui.Image? image,
    RitoBackgroundTilePlan? tilePlan,
  ) {
    final shape = _resolvedRoundedRect(rect, radius);
    final color = background.color;
    if (color != null) {
      _canvas.drawRRect(shape, ui.Paint()..color = _color(color));
    }
    if (image == null || tilePlan == null) {
      return;
    }
    _canvas.save();
    try {
      _canvas.clipRRect(shape);
      _drawBackgroundImage(image, tilePlan);
    } finally {
      _canvas.restore();
    }
  }

  void _drawBackgroundImage(ui.Image image, RitoBackgroundTilePlan plan) {
    final source = ui.Rect.fromLTWH(
      0,
      0,
      image.width.toDouble(),
      image.height.toDouble(),
    );
    final paint = _imagePaint();
    for (var row = 0; row < plan.rowCount; row += 1) {
      for (var column = 0; column < plan.columnCount; column += 1) {
        _canvas.drawImageRect(
          image,
          source,
          ui.Rect.fromLTWH(
            plan.leftAt(column),
            plan.topAt(row),
            plan.tileWidth,
            plan.tileHeight,
          ),
          paint,
        );
      }
    }
  }

  ui.Rect _backgroundTarget(
    ui.Rect source,
    ui.Rect box,
    RitoBackgroundPaint background,
  ) {
    final size = background.size ?? RitoBackgroundSize.auto;
    var width = source.width;
    var height = source.height;
    if (size != RitoBackgroundSize.auto) {
      final scale = size == RitoBackgroundSize.cover
          ? math.max(box.width / source.width, box.height / source.height)
          : math.min(box.width / source.width, box.height / source.height);
      width *= scale;
      height *= scale;
    }
    // Browser pen default: origin for auto sizing, centre once the image
    // is scaled to the box.
    final position =
        background.position ??
        (size == RitoBackgroundSize.auto
            ? const RitoBackgroundPosition(
                x: RitoPercentLength(0),
                y: RitoPercentLength(0),
              )
            : const RitoBackgroundPosition(
                x: RitoPercentLength(50),
                y: RitoPercentLength(50),
              ));
    final left = box.left + _backgroundOffset(position.x, box.width - width);
    final top = box.top + _backgroundOffset(position.y, box.height - height);
    return ui.Rect.fromLTWH(left, top, width, height);
  }

  double _backgroundOffset(RitoLength position, double freeSpace) {
    return switch (position) {
      RitoPxLength(:final value) => value,
      RitoPercentLength(:final value) => freeSpace * value / 100,
    };
  }

  void _paintBlockBorders(
    ui.Rect rect,
    ui.Radius radius,
    RitoBlockBorder? borders,
    RitoBorderBox? box,
  ) {
    if (borders == null || box == null) {
      return;
    }
    if (radius.x > 0 || radius.y > 0) {
      _paintRoundedBlockBorders(rect, radius, borders, box);
      return;
    }
    _borderSide(
      ui.Offset(rect.left, rect.top + box.topWidth / 2),
      ui.Offset(rect.right, rect.top + box.topWidth / 2),
      box.topWidth,
      borders.top,
    );
    _borderSide(
      ui.Offset(rect.left, rect.bottom - box.bottomWidth / 2),
      ui.Offset(rect.right, rect.bottom - box.bottomWidth / 2),
      box.bottomWidth,
      borders.bottom,
    );
    _borderSide(
      ui.Offset(rect.left + box.leftWidth / 2, rect.top),
      ui.Offset(rect.left + box.leftWidth / 2, rect.bottom),
      box.leftWidth,
      borders.left,
    );
    _borderSide(
      ui.Offset(rect.right - box.rightWidth / 2, rect.top),
      ui.Offset(rect.right - box.rightWidth / 2, rect.bottom),
      box.rightWidth,
      borders.right,
    );
  }

  void _borderSide(
    ui.Offset start,
    ui.Offset end,
    double width,
    RitoBorderEdgePaint? edge,
  ) {
    if (edge == null || width <= 0) {
      return;
    }
    _validateBorderStyle(edge.style, width: width, context: 'border');
    if (edge.style == RitoBorderStyle.none ||
        edge.style == RitoBorderStyle.hidden) {
      return;
    }
    if (edge.style == RitoBorderStyle.dotted && width == 1) {
      _strokeHairlineDotted(start, end, edge.color);
      return;
    }
    // Straight block edges snap to the device grid: endpoints round,
    // odd widths ride the half-pixel (browser pen strokeBorder).
    final snap = width % 2 == 1 ? 0.5 : 0.0;
    _strokeStyledLine(
      ui.Offset(start.dx.roundToDouble() + snap, start.dy.roundToDouble() + snap),
      ui.Offset(end.dx.roundToDouble() + snap, end.dy.roundToDouble() + snap),
      width,
      edge.color,
      edge.style,
    );
  }

  /// Measured against pinned Chromium (browser pen strokeHairlineDotted):
  /// a 1px dotted edge rasters as BINARY full pixels — the span's
  /// endpoints round to the device grid, dots repeat every 2px anchored
  /// at BOTH ends, and an even span resolves the parity clash with a
  /// double dot at the start: offsets {0,1,3,5,…,L−1}; an odd span is
  /// {0,2,…,L−1}. The centerline rides half a pixel below the border-box
  /// edge; the painted row is the edge rounded to the grid.
  void _strokeHairlineDotted(ui.Offset from, ui.Offset to, RitoColor color) {
    final paint = ui.Paint()..color = _color(color);
    final horizontal = from.dy == to.dy;
    final start = (horizontal ? from.dx : from.dy).round();
    final end = (horizontal ? to.dx : to.dy).round();
    final row = ((horizontal ? from.dy : from.dx) - 0.5).roundToDouble();
    final span = end - start;
    void dot(int offset) {
      final along = (start + offset).toDouble();
      _canvas.drawRect(
        horizontal
            ? ui.Rect.fromLTWH(along, row, 1, 1)
            : ui.Rect.fromLTWH(row, along, 1, 1),
        paint,
      );
    }

    var fromOffset = 0;
    if (span > 1 && span.isEven) {
      dot(0);
      dot(1);
      fromOffset = 3;
    }
    for (var offset = fromOffset; offset < span; offset += 2) {
      dot(offset);
    }
  }

  /// Rounded borders: a uniform ring strokes the rounded outline once;
  /// disagreeing edges each clip a corner-to-corner triangle from the
  /// box centre, solid edges filling outer-minus-inner even-odd and
  /// styled edges stroking the outline (browser pen borders.ts).
  void _paintRoundedBlockBorders(
    ui.Rect rect,
    ui.Radius radius,
    RitoBlockBorder borders,
    RitoBorderBox box,
  ) {
    final edges = <(RitoBorderEdgePaint?, double)>[
      (borders.top, box.topWidth),
      (borders.right, box.rightWidth),
      (borders.bottom, box.bottomWidth),
      (borders.left, box.leftWidth),
    ];
    for (final (edge, width) in edges) {
      if (edge != null && width > 0) {
        _validateBorderStyle(edge.style, width: width, context: 'border');
      }
    }
    bool visible((RitoBorderEdgePaint?, double) side) =>
        side.$1 != null &&
        side.$2 > 0 &&
        side.$1!.style != RitoBorderStyle.none &&
        side.$1!.style != RitoBorderStyle.hidden;
    if (!edges.any(visible)) {
      return;
    }
    final uniform =
        edges.every((side) => side.$2 == edges.first.$2) &&
        edges.every(
          (side) =>
              side.$1 != null &&
              _sameEdgePaint(side.$1!, edges.first.$1!),
        );
    final outline = _roundedRect(rect, radius);
    if (uniform) {
      _strokeStyledRRect(outline, edges.first.$1!, edges.first.$2);
      return;
    }

    final maxBorder = edges.fold(0.0, (m, side) => math.max(m, side.$2));
    final rx = math.min(radius.x, rect.width / 2);
    final ry = math.min(radius.y, rect.height / 2);
    final inner = ui.Rect.fromLTWH(
      rect.left + box.leftWidth,
      rect.top + box.topWidth,
      rect.width - box.leftWidth - box.rightWidth,
      rect.height - box.topWidth - box.bottomWidth,
    );
    final innerRadius = ui.Radius.elliptical(
      math.max(0, rx - maxBorder),
      math.max(0, ry - maxBorder),
    );
    final center = rect.center;
    final corners = <(ui.Offset, ui.Offset)>[
      (rect.topLeft, rect.topRight),
      (rect.topRight, rect.bottomRight),
      (rect.bottomRight, rect.bottomLeft),
      (rect.bottomLeft, rect.topLeft),
    ];
    for (var i = 0; i < 4; i += 1) {
      final (edge, width) = edges[i];
      if (edge == null || width <= 0) continue;
      if (edge.style == RitoBorderStyle.none ||
          edge.style == RitoBorderStyle.hidden) {
        continue;
      }
      final (corner1, corner2) = corners[i];
      _canvas.save();
      try {
        _canvas.clipPath(
          ui.Path()
            ..moveTo(center.dx, center.dy)
            ..lineTo(corner1.dx, corner1.dy)
            ..lineTo(corner2.dx, corner2.dy)
            ..close(),
        );
        if (edge.style != RitoBorderStyle.solid) {
          _strokeStyledRRect(outline, edge, width);
        } else {
          final fill = ui.Path()
            ..fillType = ui.PathFillType.evenOdd
            ..addRRect(outline);
          if (inner.width > 0 && inner.height > 0) {
            fill.addRRect(_roundedRect(inner, innerRadius));
          }
          _canvas.drawPath(fill, ui.Paint()..color = _color(edge.color));
        }
      } finally {
        _canvas.restore();
      }
    }
  }

  bool _sameEdgePaint(RitoBorderEdgePaint a, RitoBorderEdgePaint b) {
    return a.style == b.style && ritoUiColor(a.color) == ritoUiColor(b.color);
  }

  /// Stroke a rounded outline with the browser pen's dash vocabulary
  /// (applyStrokeStyle): dotted shrinks the pen to 0.75w with round-cap
  /// dots every 1.5w, dashed runs 3w on / 2w off, anything else strokes
  /// solid at full width.
  void _strokeStyledRRect(
    ui.RRect outline,
    RitoBorderEdgePaint edge,
    double width,
  ) {
    final style = edge.style;
    final paint = ui.Paint()
      ..style = ui.PaintingStyle.stroke
      ..color = _color(edge.color)
      ..strokeWidth = style == RitoBorderStyle.dotted ? width * .75 : width;
    if (style != RitoBorderStyle.dotted && style != RitoBorderStyle.dashed) {
      _canvas.drawRRect(outline, paint);
      return;
    }
    paint.strokeCap = style == RitoBorderStyle.dotted
        ? ui.StrokeCap.round
        : ui.StrokeCap.butt;
    final path = ui.Path()..addRRect(outline);
    final dash = style == RitoBorderStyle.dotted ? .001 : width * 3;
    final gap = style == RitoBorderStyle.dotted ? width * 1.5 : width * 2;
    for (final metric in path.computeMetrics()) {
      for (var cursor = 0.0; cursor < metric.length; cursor += dash + gap) {
        _canvas.drawPath(
          metric.extractPath(cursor, math.min(metric.length, cursor + dash)),
          paint,
        );
      }
    }
  }

  void _strokeStyledLine(
    ui.Offset start,
    ui.Offset end,
    double width,
    RitoColor color,
    RitoBorderStyle style,
  ) {
    // (shared by inline borders and horizontal rules; unsnapped)
    if (width <= 0) {
      return;
    }
    _validateBorderStyle(style, width: width, context: 'border');
    if (style == RitoBorderStyle.none || style == RitoBorderStyle.hidden) {
      return;
    }
    final vector = end - start;
    final length = vector.distance;
    if (length == 0) {
      return;
    }
    final paint = ui.Paint()
      ..color = _color(color)
      ..strokeWidth = style == RitoBorderStyle.dotted ? width * .75 : width
      ..strokeCap = style == RitoBorderStyle.dotted
          ? ui.StrokeCap.round
          : ui.StrokeCap.butt;
    if (style != RitoBorderStyle.dotted && style != RitoBorderStyle.dashed) {
      _canvas.drawLine(start, end, paint);
      return;
    }
    final unit = vector / length;
    final dash = style == RitoBorderStyle.dotted ? .001 : width * 3;
    final gap = style == RitoBorderStyle.dotted ? width * 1.5 : width * 2;
    for (var cursor = 0.0; cursor < length; cursor += dash + gap) {
      final finish = math.min(length, cursor + dash);
      _canvas.drawLine(start + unit * cursor, start + unit * finish, paint);
    }
  }
}

/// A wire radius resolved against its block rect: per-corner circular
/// radii when the corners disagree, a uniform radius otherwise (the
/// browser pen's CanvasBlockResolvedRadius).
final class _ResolvedBlockRadius {
  const _ResolvedBlockRadius(this.uniform, {this.corners});

  final ui.Radius uniform;
  final List<double>? corners;
}
