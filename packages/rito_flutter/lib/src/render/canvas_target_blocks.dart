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
    _paintBoxShadows(rect, radius, command.paint.boxShadows);
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
    _paintBlockBorders(rect, command.paint.border, command.borderBox);
  }

  ui.Radius _blockRadius(RitoBlockRadius? radius, ui.Rect rect) {
    return switch (radius) {
      null => ui.Radius.zero,
      RitoBlockPxRadius(:final value) => ui.Radius.circular(value),
      RitoBlockPercentRadius(:final value) => ui.Radius.elliptical(
        rect.width * value / 100,
        rect.height * value / 100,
      ),
    };
  }

  void _paintBoxShadows(
    ui.Rect rect,
    ui.Radius radius,
    List<RitoBoxShadow> shadows,
  ) {
    for (final shadow in shadows) {
      final shadowRect = rect
          .shift(ui.Offset(shadow.offsetX, shadow.offsetY))
          .inflate(shadow.spread);
      final shadowRadius = ui.Radius.elliptical(
        math.max(0.0, radius.x + shadow.spread),
        math.max(0.0, radius.y + shadow.spread),
      );
      final paint = ui.Paint()..color = _color(shadow.color);
      if (shadow.blur > 0) {
        paint.maskFilter = ui.MaskFilter.blur(
          ui.BlurStyle.normal,
          ritoCanvasShadowSigma(shadow.blur),
        );
      }
      _canvas.drawRRect(
        ui.RRect.fromRectAndRadius(shadowRect, shadowRadius),
        paint,
      );
    }
  }

  void _paintBlockBackground(
    ui.Rect rect,
    ui.Radius radius,
    RitoBackgroundPaint background,
    ui.Image? image,
    RitoBackgroundTilePlan? tilePlan,
  ) {
    final color = background.color;
    if (color != null) {
      _canvas.drawRRect(
        ui.RRect.fromRectAndRadius(rect, radius),
        ui.Paint()..color = _color(color),
      );
    }
    if (image == null || tilePlan == null) {
      return;
    }
    _canvas.save();
    try {
      _canvas.clipRRect(ui.RRect.fromRectAndRadius(rect, radius));
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
    final position = background.position;
    final left = box.left + _backgroundOffset(position?.x, box.width - width);
    final top = box.top + _backgroundOffset(position?.y, box.height - height);
    return ui.Rect.fromLTWH(left, top, width, height);
  }

  double _backgroundOffset(RitoLength? position, double freeSpace) {
    return switch (position) {
      null => 0,
      RitoPxLength(:final value) => value,
      RitoPercentLength(:final value) => freeSpace * value / 100,
    };
  }

  void _paintBlockBorders(
    ui.Rect rect,
    RitoBlockBorder? borders,
    RitoBorderBox? box,
  ) {
    if (borders == null || box == null) {
      return;
    }
    _borderSide(rect.topLeft, rect.topRight, box.topWidth, borders.top);
    _borderSide(rect.topRight, rect.bottomRight, box.rightWidth, borders.right);
    _borderSide(
      rect.bottomRight,
      rect.bottomLeft,
      box.bottomWidth,
      borders.bottom,
    );
    _borderSide(rect.bottomLeft, rect.topLeft, box.leftWidth, borders.left);
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
    _strokeStyledLine(start, end, width, edge.color, edge.style);
  }

  void _strokeStyledLine(
    ui.Offset start,
    ui.Offset end,
    double width,
    RitoColor color,
    RitoBorderStyle style,
  ) {
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
    if (style == RitoBorderStyle.double && width >= 3) {
      final normal = ui.Offset(-vector.dy, vector.dx) / length * (width / 3);
      paint.strokeWidth = width / 3;
      _canvas.drawLine(start - normal, end - normal, paint);
      _canvas.drawLine(start + normal, end + normal, paint);
      return;
    }
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
