part of 'canvas_target.dart';

extension _BlockPainting on RitoCanvasPaintTarget {
  void _paintPage(RitoPaintPage command) {
    final color = command.paint.backgroundColor;
    if (color == null) {
      return;
    }
    _blockGrounds.clear();
    _bookOwnedPageGround = null;
    // R1, page-ground ownership: a designed ground (opaque and darker
    // than the white-paper limit) is a choice the book expressed — keep
    // it and mark the page book-owned. Near-white/unstated grounds are
    // the typesetter's white-paper default assumption; the theme takes
    // those over. Absent commands stay absent — the override never
    // invents a page fill (browser pen parity).
    final override = _colorOverride;
    ui.Color fill;
    if (override == null) {
      fill = _color(color);
    } else {
      final book = ritoUiColor(color);
      if (RitoCanvasColorOverride.isBookOwnedPageGround(book)) {
        _bookOwnedPageGround = book;
        fill = _color(color);
      } else {
        fill = override.background.withValues(
          alpha: override.background.a * _opacity,
        );
      }
    }
    _canvas.drawRect(_rect(command.rect), ui.Paint()..color = fill);
  }

  void _paintBlock(RitoPaintBlock command) {
    final rect = _rect(command.rect);
    final backgroundColor = command.paint.background?.color;
    if (backgroundColor != null) {
      final ground = ritoUiColor(backgroundColor);
      if (ground.a >= 1) {
        _blockGrounds.add((rect: rect, color: ground));
      }
    }
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
    double ratio(double extent, double sum) => extent / math.max(1e-6, sum);
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
  /// of the browser pen's traceRoundedRect: when either axis would make
  /// adjacent corners cross on a short edge, BOTH axes shrink by the
  /// same factor (CSS Backgrounds §5.5). Per-axis clamping kept the long
  /// axis at its authored radius and turned a wide `border-radius: 30px`
  /// badge into an ellipse where Blink draws a stadium.
  ui.RRect _roundedRect(ui.Rect rect, ui.Radius radius) {
    final rx = math.max(0.0, radius.x);
    final ry = math.max(0.0, radius.y);
    final scale = math.min(
      1.0,
      math.min(
        rx > 0 ? rect.width / (2 * rx) : 1.0,
        ry > 0 ? rect.height / (2 * ry) : 1.0,
      ),
    );
    return ui.RRect.fromRectXY(rect, rx * scale, ry * scale);
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
    if (size.isExplicit) {
      // CSS Backgrounds 3 §3.9: a length axis resolves against the
      // positioning area, an auto axis derives from the intrinsic ratio
      // once the other axis resolves.
      final x = _explicitAxis(size.x, box.width);
      final y = _explicitAxis(size.y, box.height);
      width = x ?? (y == null ? source.width : y * source.width / source.height);
      height = y ?? (x == null ? source.height : x * source.height / source.width);
    } else if (size != RitoBackgroundSize.auto) {
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

  double? _explicitAxis(RitoLength? axis, double boxExtent) {
    return switch (axis) {
      null => null,
      RitoPxLength(:final value) => value,
      RitoPercentLength(:final value) => boxExtent * value / 100,
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
    // The browser rasters a border box on whole device pixels — each
    // edge rounds independently (browser pen renderStraightBorders).
    final right = (rect.left + rect.width).roundToDouble();
    final bottom = (rect.top + rect.height).roundToDouble();
    final left = rect.left.roundToDouble();
    final top = rect.top.roundToDouble();
    _borderSide(
      ui.Offset(left, top + box.topWidth / 2),
      ui.Offset(right, top + box.topWidth / 2),
      box.topWidth,
      borders.top,
    );
    _borderSide(
      ui.Offset(left, bottom - box.bottomWidth / 2),
      ui.Offset(right, bottom - box.bottomWidth / 2),
      box.bottomWidth,
      borders.bottom,
    );
    _borderSide(
      ui.Offset(left + box.leftWidth / 2, top),
      ui.Offset(left + box.leftWidth / 2, bottom),
      box.leftWidth,
      borders.left,
    );
    _borderSide(
      ui.Offset(right - box.rightWidth / 2, top),
      ui.Offset(right - box.rightWidth / 2, bottom),
      box.rightWidth,
      borders.right,
    );
  }

  /// One straight border edge, mirroring the browser pen's strokeBorder
  /// dispatch: the caller hands the whole band's CENTERLINE on an
  /// already-snapped border box.
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
    final horizontal = start.dy == end.dy;
    if (edge.style == RitoBorderStyle.dotted && width.round() >= 1) {
      if (width.round() <= 3) {
        _strokeBinaryDotted(edge.color, width, start, end, horizontal);
      } else {
        _strokeMeasuredDotCircles(edge.color, width, start, end, horizontal);
      }
      return;
    }
    if (edge.style == RitoBorderStyle.dashed) {
      _strokeMeasuredDashed(edge.color, width, start, end, horizontal);
      return;
    }
    // Blink's double border: two lines of a third each with a third of
    // gap, the sub-lines' centerlines at ±width/3 around the band's.
    if (edge.style == RitoBorderStyle.double) {
      final third = width / 3;
      final line = RitoBorderEdgePaint(
        color: edge.color,
        style: RitoBorderStyle.solid,
      );
      final shift = horizontal
          ? ui.Offset(0, third)
          : ui.Offset(third, 0);
      _borderSide(start - shift, end - shift, third, line);
      _borderSide(start + shift, end + shift, third, line);
      return;
    }
    // Measured Blink solid-border raster (browser pen strokeBorder): the
    // band is BINARY device rows — it starts at round(border-box edge)
    // and spans max(1, floor(width)) rows, no antialiasing at any
    // sub-pixel phase. Groove/ridge/inset/outset reach the pen as solid
    // strokes (the bridge pre-shades them), so every remaining style
    // takes the binary band.
    final paint = ui.Paint()..color = _color(edge.color);
    final band = math.max(1.0, width.floorToDouble());
    if (horizontal) {
      final left = math.min(start.dx, end.dx).roundToDouble();
      final right = math.max(start.dx, end.dx).roundToDouble();
      final row = (start.dy - width / 2).roundToDouble();
      _canvas.drawRect(ui.Rect.fromLTWH(left, row, right - left, band), paint);
    } else {
      final top = math.min(start.dy, end.dy).roundToDouble();
      final bottom = math.max(start.dy, end.dy).roundToDouble();
      final column = (start.dx - width / 2).roundToDouble();
      _canvas.drawRect(
        ui.Rect.fromLTWH(column, top, band, bottom - top),
        paint,
      );
    }
  }

  /// Chromium's thin-dotted stroke (browser pen strokeBinaryDotted,
  /// width rounding to 1-3): BINARY square dashes of side = the rounded
  /// width on an exact 2-width period, phase anchored at the span start,
  /// plus an endpoint-enforcement table that redraws the first/last dot
  /// and shifts the dash run so full dots land on both ends whenever the
  /// span's remainder modulo the period allows it.
  void _strokeBinaryDotted(
    RitoColor color,
    double width,
    ui.Offset from,
    ui.Offset to,
    bool horizontal,
  ) {
    final paint = ui.Paint()..color = _color(color);
    final size = width.round();
    final start = (horizontal ? math.min(from.dx, to.dx) : math.min(from.dy, to.dy)).round();
    final end = (horizontal ? math.max(from.dx, to.dx) : math.max(from.dy, to.dy)).round();
    // The caller hands the CENTERLINE; the painted band anchors at the
    // rounded border-box edge.
    final row = ((horizontal ? from.dy : from.dx) - width / 2).roundToDouble();
    final band = math.max(1.0, width.floorToDouble());
    final span = end - start;
    void put(num offset, num length) {
      if (length <= 0) return;
      _canvas.drawRect(
        horizontal
            ? ui.Rect.fromLTWH(
                (start + offset).toDouble(), row, length.toDouble(), band)
            : ui.Rect.fromLTWH(
                row, (start + offset).toDouble(), band, length.toDouble()),
        paint,
      );
    }

    final mod4 = span % 4;
    final mod6 = span % 6;
    var useStartDot = false;
    var startDotGrowth = 0;
    var startLineOffset = 0;
    var useEndDot = false;
    var endDotGrowth = 0;
    if ((size == 1 && span % 2 == 0) || (size == 3 && mod6 == 0)) {
      useStartDot = true;
      startDotGrowth = 1;
      startLineOffset = 1;
    }
    if ((size == 2 && (mod4 == 0 || mod4 == 1)) ||
        (size == 3 && (mod6 == 1 || mod6 == 2))) {
      useStartDot = true;
      startLineOffset = -1;
    }
    if ((size == 2 && mod4 == 0) || (size == 3 && mod6 == 1)) {
      useEndDot = true;
    }
    if ((size == 2 && mod4 == 3) || (size == 3 && (mod6 == 4 || mod6 == 5))) {
      useStartDot = true;
      startLineOffset = 1;
    }
    if (size == 3 && mod6 == 5) {
      useEndDot = true;
    } else if (size == 3 && mod6 == 0) {
      useEndDot = true;
      endDotGrowth = 1;
    }
    var lineStart = 0;
    var lineEnd = span;
    if (useStartDot) {
      put(0, size + startDotGrowth);
      lineStart = 2 * size + startLineOffset;
    }
    if (useEndDot) {
      put(span - size - endDotGrowth, size + endDotGrowth);
      lineEnd = span - (size + endDotGrowth + 1);
    }
    for (var offset = lineStart; offset < lineEnd; offset += 2 * size) {
      put(offset, math.min(size, lineEnd - offset));
    }
  }

  /// Chromium's thick-dotted stroke (browser pen
  /// strokeMeasuredDotCircles, width rounding above 3): round dots of
  /// diameter = width, spaced by the gap that best approximates one
  /// width between dots, pitch minus a 0.01 epsilon so the final dot
  /// survives float accumulation.
  void _strokeMeasuredDotCircles(
    RitoColor color,
    double width,
    ui.Offset from,
    ui.Offset to,
    bool horizontal,
  ) {
    final paint = ui.Paint()..color = _color(color);
    final start = (horizontal ? math.min(from.dx, to.dx) : math.min(from.dy, to.dy)).roundToDouble();
    final end = (horizontal ? math.max(from.dx, to.dx) : math.max(from.dy, to.dy)).roundToDouble();
    // The caller hands the CENTERLINE; the dot row centers on it.
    final center = horizontal ? from.dy : from.dx;
    final span = end - start;
    // Spacing follows the rounded width; the dot keeps the true stroke
    // diameter.
    final dashWidth = width.roundToDouble();
    final radius = width / 2;
    void dot(double at) {
      _canvas.drawCircle(
        horizontal ? ui.Offset(at, center) : ui.Offset(center, at),
        radius,
        paint,
      );
    }

    final minDashes = ((span + dashWidth) / (2 * dashWidth)).floorToDouble();
    final maxDashes = minDashes + 1;
    final minGap = (span - minDashes * dashWidth) / (minDashes - 1);
    final maxGap = (span - maxDashes * dashWidth) / (maxDashes - 1);
    final useMin = maxGap <= 0 ||
        (minGap - dashWidth).abs() < (maxGap - dashWidth).abs();
    final count = (useMin ? minDashes : maxDashes).toInt();
    final gap = useMin ? minGap : maxGap;
    if (span < 2 * dashWidth || count <= 1 || !gap.isFinite) {
      dot(start + dashWidth / 2);
      return;
    }
    final pitch = dashWidth + gap - 0.01;
    for (var index = 0; index < count; index += 1) {
      dot(start + dashWidth / 2 + index * pitch);
    }
  }

  /// Chromium's dashed edge (browser pen strokeMeasuredDashed): the SAME
  /// binary device band as a solid edge, with the browser's STRETCHED
  /// cadence — base dash 3w with base gap 2w picks the dash count
  /// n = floor((L + 2w) / 5w), then the gap stretches so a full dash
  /// lands flush at BOTH ends. Dash extents stay fractional along the
  /// run axis; their AA ends match the browser's.
  void _strokeMeasuredDashed(
    RitoColor color,
    double width,
    ui.Offset from,
    ui.Offset to,
    bool horizontal,
  ) {
    final paint = ui.Paint()..color = _color(color);
    final band = math.max(1.0, width.floorToDouble());
    final start = (horizontal ? math.min(from.dx, to.dx) : math.min(from.dy, to.dy)).roundToDouble();
    final end = (horizontal ? math.max(from.dx, to.dx) : math.max(from.dy, to.dy)).roundToDouble();
    // The caller hands the CENTERLINE; the band anchors at the rounded
    // border-box edge, exactly like the solid arm.
    final row = ((horizontal ? from.dy : from.dx) - width / 2).roundToDouble();
    final span = end - start;
    final dash = 3 * width;
    final count = ((span + 2 * width) / (5 * width)).floor();
    void put(double at, double length) {
      _canvas.drawRect(
        horizontal
            ? ui.Rect.fromLTWH(at, row, length, band)
            : ui.Rect.fromLTWH(row, at, band, length),
        paint,
      );
    }

    if (count <= 1 || span <= dash) {
      put(start, math.min(span, dash));
      return;
    }
    final gap = (span - dash * count) / (count - 1);
    for (var index = 0; index < count; index += 1) {
      put(start + index * (dash + gap), dash);
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
              side.$1 != null && _sameEdgePaint(side.$1!, edges.first.$1!),
        );
    final outline = _roundedRect(rect, radius);
    if (uniform) {
      _strokeStyledRRect(rect, radius, edges.first.$1!, edges.first.$2);
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
          _strokeStyledRRect(rect, radius, edge, width);
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
    ui.Rect rect,
    ui.Radius radius,
    RitoBorderEdgePaint edge,
    double width,
  ) {
    final style = edge.style;
    // The border ink lives INSIDE the border box (browser pen
    // renderUniformRoundedBorder): the stroke centerline sits half a
    // width in from the rounded outer path, matching Blink's ink span
    // from the border-box edge to the padding-box edge. Stroking the
    // outer path itself hangs half the ink outside the box.
    ui.RRect ring(double inset) => _roundedRect(
      rect.deflate(inset),
      ui.Radius.elliptical(
        math.max(0, radius.x - inset),
        math.max(0, radius.y - inset),
      ),
    );
    if (style == RitoBorderStyle.double) {
      // Blink's double: two lines of a third each, a third of gap — the
      // outer line's centerline sits width/6 in from the outer path,
      // the inner line's width/6 out from the padding path.
      final third = width / 3;
      final paint = ui.Paint()
        ..style = ui.PaintingStyle.stroke
        ..color = _color(edge.color)
        ..strokeWidth = third;
      for (final inset in <double>[third / 2, width - third / 2]) {
        _canvas.drawRRect(ring(inset), paint);
      }
      return;
    }
    final paint = ui.Paint()
      ..style = ui.PaintingStyle.stroke
      ..color = _color(edge.color)
      ..strokeWidth = style == RitoBorderStyle.dotted ? width * .75 : width;
    if (style != RitoBorderStyle.dotted && style != RitoBorderStyle.dashed) {
      _canvas.drawRRect(ring(width / 2), paint);
      return;
    }
    paint.strokeCap = style == RitoBorderStyle.dotted
        ? ui.StrokeCap.round
        : ui.StrokeCap.butt;
    final path = ui.Path()..addRRect(ring(width / 2));
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
