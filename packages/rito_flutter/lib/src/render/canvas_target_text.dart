part of 'canvas_target.dart';

extension _TextPainting on RitoCanvasPaintTarget {
  void _paintText(RitoPaintText command) {
    _paintStringRun(command, ruby: false);
  }

  void _paintRuby(RitoPaintRuby command) {
    _paintStringRun(command, ruby: true);
  }

  /// The engine pre-composes the run rect so its em-top encodes
  /// `baseline - 0.8 * sizePx` (fragment_paint::CANVAS_TOP_ASCENT_RATIO).
  /// The browser pen paints with `textBaseline: 'alphabetic'`, which
  /// Chromium snaps to the nearest device row — bit-identical to Blink's
  /// DOM raster. Mirror both stages: resolve the target row, then anchor
  /// the laid-out run by its actual alphabetic baseline.
  static const double _canvasTopAscentRatio = 0.8;

  void _paintStringRun(RitoTextPaintCommand command, {required bool ruby}) {
    final rect = _rect(command.rect);
    _validateRunPaint(command.paint);
    _paintInlineBackground(rect, command.paint);
    final painter = TextPainter(
      text: TextSpan(
        text: command.text,
        // Ruby ignores run spacing, matching the browser pen's forced
        // '0px' letter/word spacing.
        style: _textStyle(command.paint, includeSpacing: !ruby),
      ),
      textDirection: ui.TextDirection.ltr,
      maxLines: 1,
    )..layout();
    final baselineOffset = painter.computeDistanceToActualBaseline(
      TextBaseline.alphabetic,
    );
    // SkParagraph splits letter spacing across both cluster edges where
    // Chromium trails all of it after the cluster — same total advance,
    // the whole run sits half a spacing to the right (measured via the
    // parity corpus ink scan). Compensate at the glyph origin only; the
    // rect geometry is spacing-free.
    final x = ruby
        ? rect.left + (rect.width - painter.width) / 2
        : rect.left - (command.paint.letterSpacingPx ?? 0) / 2;
    // Ruby anchors its em-box top at the rect (browser textBaseline
    // 'top' = OS/2 sTypoAscender, probed against pinned Chromium);
    // regular runs anchor their alphabetic baseline at the snapped row.
    // Either way the raster lands the baseline on a whole device row.
    final baselineRow =
        (rect.top + _canvasTopAscentRatio * command.paint.font.sizePx)
            .roundToDouble();
    final topAscent =
        _fontEnvelopes
            ?.lookup(command.paint.font.family)
            ?.topAnchorAscentPx(command.paint.font.sizePx) ??
        baselineOffset;
    final topAnchorY =
        (rect.top + topAscent).roundToDouble() - baselineOffset;
    final origin = ruby
        ? ui.Offset(x, topAnchorY)
        : ui.Offset(x, baselineRow - baselineOffset);
    if (command.paint.textShadows.isNotEmpty) {
      // The browser pen's shadow scratch pass anchors with textBaseline
      // 'top' at the rect — deliberately NOT the glyph's snapped
      // alphabetic anchor. Mirror that offset exactly; the remaining
      // divergence is Chromium's sub-pixel AA phase, which Skia's
      // whole-row glyph snap cannot reproduce (accounted AA exemption).
      _paintTextShadows(painter, command.paint, ui.Offset(x, topAnchorY));
    }
    painter.paint(_canvas, origin);
    _paintDecoration(rect, command.paint.decoration);
    _paintRunBorders(rect, command.paint.border);
  }

  /// Mirrors the browser pen's scratch-canvas shadow pass: layers render
  /// back-to-front, the glyph body is knocked out of the accumulated
  /// shadow bitmap, and the glyph itself paints on top afterwards.
  /// Canvas `shadowBlur` is twice the Gaussian sigma, so the mask filter
  /// gets `blur / 2` directly instead of Flutter's radius conversion.
  void _paintTextShadows(
    TextPainter painter,
    RitoRunPaint paint,
    ui.Offset origin,
  ) {
    final bounds = ui.Rect.fromLTWH(
      origin.dx,
      origin.dy,
      painter.width,
      painter.height,
    );
    var pad = 0.0;
    for (final shadow in paint.textShadows) {
      pad = math.max(
        pad,
        shadow.blur * 2 + math.max(shadow.offsetX.abs(), shadow.offsetY.abs()),
      );
    }
    _canvas.saveLayer(bounds.inflate(pad + 1), ui.Paint());
    try {
      for (final shadow in paint.textShadows.reversed) {
        final layerPaint = ui.Paint()..color = _color(shadow.color);
        if (shadow.blur > 0) {
          layerPaint.maskFilter = ui.MaskFilter.blur(
            ui.BlurStyle.normal,
            shadow.blur / 2,
          );
        }
        _paintRunWithPaint(
          painter,
          paint,
          layerPaint,
          origin.translate(shadow.offsetX, shadow.offsetY),
        );
      }
      // Knock the glyph body out so the shadow never tints it; the real
      // glyph paints over the hole afterwards.
      _paintRunWithPaint(
        painter,
        paint,
        ui.Paint()
          ..color = const ui.Color(0xff000000)
          ..blendMode = ui.BlendMode.dstOut,
        origin,
      );
    } finally {
      _canvas.restore();
    }
  }

  void _paintRunWithPaint(
    TextPainter source,
    RitoRunPaint paint,
    ui.Paint foreground,
    ui.Offset origin,
  ) {
    final span = source.text! as TextSpan;
    final layer = TextPainter(
      text: TextSpan(
        text: span.text,
        style: _textStyle(paint, foreground: foreground),
      ),
      textDirection: ui.TextDirection.ltr,
      maxLines: 1,
    )..layout();
    layer.paint(_canvas, origin);
  }

  TextStyle _textStyle(
    RitoRunPaint paint, {
    ui.Paint? foreground,
    bool includeSpacing = true,
  }) {
    final font = paint.font;
    return TextStyle(
      color: foreground == null ? _color(paint.color) : null,
      foreground: foreground,
      fontFamily: font.family.isEmpty ? null : font.family,
      fontSize: font.sizePx,
      fontStyle: font.style == RitoFontStyle.italic
          ? FontStyle.italic
          : FontStyle.normal,
      fontWeight: _fontWeight(font.weight),
      wordSpacing: includeSpacing ? paint.wordSpacingPx : null,
      letterSpacing: includeSpacing ? paint.letterSpacingPx : null,
    );
  }

  FontWeight _fontWeight(double value) {
    final index = ((value / 100).round() - 1).clamp(0, 8).toInt();
    return FontWeight.values[index];
  }

  void _paintInlineBackground(ui.Rect rect, RitoRunPaint paint) {
    final color = paint.backgroundColor;
    if (color == null) {
      return;
    }
    _canvas.drawRRect(
      ui.RRect.fromRectAndRadius(
        rect,
        ui.Radius.circular(paint.backgroundRadius ?? 0),
      ),
      ui.Paint()..color = _color(color),
    );
  }

  void _paintDecoration(ui.Rect rect, RitoRunDecoration? decoration) {
    if (decoration == null || decoration.thickness <= 0) {
      return;
    }
    final y = rect.top + decoration.y;
    _canvas.drawLine(
      ui.Offset(rect.left, y),
      ui.Offset(rect.right, y),
      ui.Paint()
        ..color = _color(decoration.color)
        ..strokeWidth = decoration.thickness,
    );
  }

  void _paintRunBorders(ui.Rect rect, RitoRunBorder? border) {
    if (border == null) {
      return;
    }
    _runBorder(rect.topLeft, rect.topRight, border.top);
    _runBorder(rect.bottomLeft, rect.bottomRight, border.bottom);
    _runBorder(rect.topLeft, rect.bottomLeft, border.start);
    _runBorder(rect.topRight, rect.bottomRight, border.end);
  }

  void _runBorder(ui.Offset start, ui.Offset end, RitoRunBorderEdge? edge) {
    if (edge == null) {
      return;
    }
    _strokeStyledLine(
      start,
      end,
      edge.widthPx,
      edge.paint.color,
      edge.paint.style,
    );
  }

  void _validateRunPaint(RitoRunPaint paint) {
    for (final shadow in paint.textShadows) {
      if (shadow.blur < 0) {
        throw const RitoWireException(
          'RITODL1 text-shadow blur radius must not be negative.',
        );
      }
    }
    final border = paint.border;
    if (border == null) {
      return;
    }
    _validateRunBorderEdge(border.top, 'top text border');
    _validateRunBorderEdge(border.bottom, 'bottom text border');
    _validateRunBorderEdge(border.start, 'start text border');
    _validateRunBorderEdge(border.end, 'end text border');
  }

  void _validateRunBorderEdge(RitoRunBorderEdge? edge, String context) {
    if (edge == null) {
      return;
    }
    _validateBorderStyle(
      edge.paint.style,
      width: edge.widthPx,
      context: context,
    );
  }
}
