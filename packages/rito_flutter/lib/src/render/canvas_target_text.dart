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
    // Browser pen order: background, borders, shadows, glyphs,
    // decoration.
    _paintInlineBackground(rect, command.paint);
    _paintRunBorders(rect, command.paint);
    final painter = TextPainter(
      text: TextSpan(
        text: command.text,
        // Ruby ignores run spacing, matching the browser pen's forced
        // '0px' letter/word spacing.
        style: _textStyle(command.paint, includeSpacing: !ruby, runRect: rect),
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
            ?.lookupFamilyStack(command.paint.font.family)
            ?.topAnchorAscentPx(command.paint.font.sizePx) ??
        baselineOffset;
    final topAnchorY = (rect.top + topAscent).roundToDouble() - baselineOffset;
    final origin = ruby
        ? ui.Offset(x, topAnchorY)
        : ui.Offset(x, baselineRow - baselineOffset);
    if (command.paint.textShadows.isNotEmpty) {
      // Shadow ink must be congruent with the glyph ink it copies: the
      // browser pen's scratch blit lands the shadow at the same baseline
      // its own glyph paints on, offset only by the shadow's offsets.
      // Anchoring the shadow at the ruby top anchor while the glyph
      // paints at the snapped alphabetic row floated every glow a few
      // pixels above its glyphs (b52 colorpages dialogue).
      _paintTextShadows(painter, command.paint, origin);
    }
    painter.paint(_canvas, origin);
    _paintDecoration(rect, command.paint.decoration);
  }

  /// Mirrors the browser pen's scratch-canvas shadow pass: layers render
  /// back-to-front UNDER the glyph in full — Blink composites shadow
  /// underneath and body on top, the shadow color blending through the
  /// glyph's antialiased edges. Knocking the glyph body out of the
  /// shadow first weighted every edge fringe by (1-a) twice, and a
  /// white glyph on a pure-blur colored glow read hollow and washed
  /// out against the browser (b52 colorpages dialogue).
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
    ui.Rect? runRect,
  }) {
    final font = paint.font;
    // The run family is a comma-joined CSS fallback stack (book faces,
    // pinned aliases, generic tail). Canvas resolves it natively; here
    // it must split into Flutter's single-family + fallback-list shape
    // or the literal stack string never matches a registered face.
    final families = ritoSplitFontFamilyStack(font.family);
    return TextStyle(
      color: foreground == null ? _effectiveTextColor(paint, runRect) : null,
      foreground: foreground,
      fontFamily: families.isEmpty ? null : families.first,
      fontFamilyFallback: families.length > 1 ? families.sublist(1) : null,
      fontSize: font.sizePx,
      fontStyle: font.style == RitoFontStyle.italic
          ? FontStyle.italic
          : FontStyle.normal,
      fontWeight: _paintWeight(families, font.weight),
      wordSpacing: includeSpacing ? paint.wordSpacingPx : null,
      letterSpacing: includeSpacing ? paint.letterSpacingPx : null,
    );
  }

  /// The weight to hand Flutter so its synthesis decision matches CSS.
  ///
  /// CSS matches a face by the `@font-face` descriptor; Flutter matches
  /// by the face's own `OS/2.usWeightClass`. When a book ships one file
  /// and declares it as its bold, CSS renders that file as-is while
  /// Flutter — seeing a 400-weight file under a 700 request — emboldens
  /// it, painting heavier than the browser and than the designer chose.
  /// Asking for a sub-bold weight suppresses that, and is only safe
  /// because the family holds exactly one face, so there is no other
  /// face for the lower number to select.
  ///
  /// Everything else passes through: a family that declares itself
  /// Regular still synthesizes under a bold run, which is what the
  /// browser does with the same declaration.
  FontWeight _paintWeight(List<String> families, double requested) {
    if (requested < 600 || families.isEmpty) {
      return _fontWeight(requested);
    }
    final store = _fontEnvelopes;
    if (store == null) {
      return _fontWeight(requested);
    }
    final head = families.first;
    final envelope = store.lookup(head);
    if (envelope == null ||
        !envelope.declaredBold ||
        store.faceCount(head) != 1) {
      return _fontWeight(requested);
    }
    return FontWeight.w400;
  }

  FontWeight _fontWeight(double value) {
    final index = ((value / 100).round() - 1).clamp(0, 8).toInt();
    return FontWeight.values[index];
  }

  /// Run ink is only re-resolved when its ground is theme-supplied
  /// (R2): a declared ground — the run's own inline band, an opaque
  /// block fill containing the run, or a book-owned page ground — means
  /// the color pair was the typesetter's choice and stays untouched.
  /// On the theme ground it follows the override's contrast policy
  /// (browser pen's resolveTextColor). Decoration and shadow layer
  /// colors deliberately stay original, matching the browser pen.
  ui.Color _effectiveTextColor(RitoRunPaint paint, ui.Rect? runRect) {
    final color = _color(paint.color);
    final override = _colorOverride;
    if (override == null) {
      return color;
    }
    final effective = override.effectiveTextColor(
      color,
      declaredGround: runRect == null ? null : _declaredGroundFor(paint, runRect),
    );
    // _color already carries the opacity stack; a theme substitution
    // must re-apply it (the browser pen's globalAlpha does this).
    return identical(effective, color)
        ? color
        : effective.withValues(alpha: effective.a * _opacity);
  }

  /// The ground a run's ink was typeset against, when the book
  /// expressed one: the run's own inline background, else the nearest
  /// opaque block background containing the run's rect, else the page
  /// ground R1 kept for the book. Null means the theme supplies the
  /// ground. Mirrors the browser pen's declaredGroundFor.
  ui.Color? _declaredGroundFor(RitoRunPaint paint, ui.Rect rect) {
    final runBackground = paint.backgroundColor;
    if (runBackground != null) {
      final ground = ritoUiColor(runBackground);
      if (ground.a >= 1) {
        return ground;
      }
    }
    for (var index = _blockGrounds.length - 1; index >= 0; index -= 1) {
      final ground = _blockGrounds[index];
      if (rect.left >= ground.rect.left &&
          rect.top >= ground.rect.top &&
          rect.left + rect.width <= ground.rect.left + ground.rect.width &&
          rect.top + rect.height <= ground.rect.top + ground.rect.height) {
        return ground.color;
      }
    }
    return _bookOwnedPageGround;
  }

  /// Content-height box for inline backgrounds and borders, mirroring
  /// the browser pen's computeInlineBoxRect: the band spans the run
  /// font's grid-fit ascent to descent around the baseline (canvas
  /// fontBoundingBox = rounded OS/2 win metrics), not the em box, then
  /// grows by padding and border widths. Without envelope metrics the
  /// em box stands in, exactly like the browser fallback.
  ui.Rect _inlineBoxRect(ui.Rect rect, RitoRunPaint paint) {
    final padding = paint.padding;
    final border = paint.border;
    final paddingLeft = padding?.left ?? 0;
    final paddingRight = padding?.right ?? 0;
    final paddingTop = padding?.top ?? 0;
    final paddingBottom = padding?.bottom ?? 0;
    final borderLeft = border?.start?.widthPx ?? 0;
    final borderRight = border?.end?.widthPx ?? 0;
    final borderTop = border?.top?.widthPx ?? 0;
    final borderBottom = border?.bottom?.widthPx ?? 0;

    // The engine's own inline box extents are authoritative when the
    // paint carries them (browser pen computeInlineBoxRect prefers
    // paint.box); font metrics only cover paints without them.
    final boxTop = paint.boxTopPx;
    final boxBottom = paint.boxBottomPx;
    if (boxTop != null && boxBottom != null) {
      return ui.Rect.fromLTRB(
        (rect.left - paddingLeft - borderLeft).roundToDouble(),
        (rect.top + boxTop).roundToDouble(),
        (rect.left + rect.width + paddingRight + borderRight).roundToDouble(),
        (rect.top + boxBottom).roundToDouble(),
      );
    }
    final size = paint.font.sizePx;
    var contentTop = rect.top;
    var contentHeight = size;
    final envelope = _fontEnvelopes?.lookupFamilyStack(paint.font.family);
    if (envelope != null) {
      final ascent = envelope.boundingAscentPx(size);
      final descent = envelope.boundingDescentPx(size);
      contentTop = rect.top + _canvasTopAscentRatio * size - ascent;
      contentHeight = ascent + descent;
    }
    // The inline box rasters on whole device pixels — all four edges
    // round independently (browser pen computeInlineBoxRect), so band
    // tops and bottoms are binary rows instead of AA smears.
    return ui.Rect.fromLTRB(
      (rect.left - paddingLeft - borderLeft).roundToDouble(),
      (contentTop - paddingTop - borderTop).roundToDouble(),
      (rect.left + rect.width + paddingRight + borderRight).roundToDouble(),
      (contentTop + contentHeight + paddingBottom + borderBottom)
          .roundToDouble(),
    );
  }

  ui.RRect _inlineRoundedRect(
    ui.Rect box,
    double radius, {
    bool roundStart = true,
    bool roundEnd = true,
  }) {
    // An inline box split across shaping runs paints one continuous
    // background: only the opening segment rounds its left corners and
    // only the closing one its right corners (browser pen
    // traceInlineRoundedRect).
    final resolved = math.min(radius, math.min(box.width / 2, box.height / 2));
    final start = roundStart ? ui.Radius.circular(resolved) : ui.Radius.zero;
    final end = roundEnd ? ui.Radius.circular(resolved) : ui.Radius.zero;
    return ui.RRect.fromRectAndCorners(
      box,
      topLeft: start,
      bottomLeft: start,
      topRight: end,
      bottomRight: end,
    );
  }

  void _paintInlineBackground(ui.Rect rect, RitoRunPaint paint) {
    final color = paint.backgroundColor;
    if (color == null) {
      return;
    }
    final box = _inlineBoxRect(rect, paint);
    final radius = paint.backgroundRadius ?? 0;
    final fill = ui.Paint()..color = _color(color);
    if (radius > 0) {
      _canvas.drawRRect(
        _inlineRoundedRect(
          box,
          radius,
          roundStart: paint.boxStart,
          roundEnd: paint.boxEnd,
        ),
        fill,
      );
    } else {
      _canvas.drawRect(box, fill);
    }
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

  void _paintRunBorders(ui.Rect rect, RitoRunPaint paint) {
    final border = paint.border;
    if (border == null) {
      return;
    }
    final top = border.top;
    final bottom = border.bottom;
    final start = border.start;
    final end = border.end;
    if (top == null && bottom == null && start == null && end == null) {
      return;
    }
    final box = _inlineBoxRect(rect, paint);
    final radius = paint.backgroundRadius ?? 0;
    if (top != null &&
        bottom != null &&
        start != null &&
        end != null &&
        radius > 0) {
      _paintRoundedInlineBorders(box, radius, top, end, bottom, start);
      return;
    }
    // Straight edges stroke centred half a width inside the box edge,
    // unsnapped, matching the browser pen's drawStraightInlineBorders.
    if (top != null) {
      _inlineEdge(
        ui.Offset(box.left, box.top + top.widthPx / 2),
        ui.Offset(box.right, box.top + top.widthPx / 2),
        top,
      );
    }
    if (bottom != null) {
      _inlineEdge(
        ui.Offset(box.left, box.bottom - bottom.widthPx / 2),
        ui.Offset(box.right, box.bottom - bottom.widthPx / 2),
        bottom,
      );
    }
    if (start != null) {
      _inlineEdge(
        ui.Offset(box.left + start.widthPx / 2, box.top),
        ui.Offset(box.left + start.widthPx / 2, box.bottom),
        start,
      );
    }
    if (end != null) {
      _inlineEdge(
        ui.Offset(box.right - end.widthPx / 2, box.top),
        ui.Offset(box.right - end.widthPx / 2, box.bottom),
        end,
      );
    }
  }

  /// Full four-edge rounded case: each side clips a triangle from the
  /// box centre and strokes the rounded outline at its own width,
  /// mirroring drawRoundedInlineBorders.
  void _paintRoundedInlineBorders(
    ui.Rect box,
    double radius,
    RitoRunBorderEdge top,
    RitoRunBorderEdge end,
    RitoRunBorderEdge bottom,
    RitoRunBorderEdge start,
  ) {
    final center = box.center;
    final sides = <(RitoRunBorderEdge, ui.Offset, ui.Offset)>[
      (top, box.topLeft, box.topRight),
      (end, box.topRight, box.bottomRight),
      (bottom, box.bottomRight, box.bottomLeft),
      (start, box.bottomLeft, box.topLeft),
    ];
    final outline = _inlineRoundedRect(box, radius);
    for (final (edge, corner1, corner2) in sides) {
      _canvas.save();
      try {
        _canvas.clipPath(
          ui.Path()
            ..moveTo(center.dx, center.dy)
            ..lineTo(corner1.dx, corner1.dy)
            ..lineTo(corner2.dx, corner2.dy)
            ..close(),
        );
        _canvas.drawRRect(
          outline,
          ui.Paint()
            ..style = ui.PaintingStyle.stroke
            ..strokeWidth = edge.widthPx
            ..color = _color(edge.paint.color),
        );
      } finally {
        _canvas.restore();
      }
    }
  }

  void _inlineEdge(ui.Offset from, ui.Offset to, RitoRunBorderEdge edge) {
    _strokeStyledLine(
      from,
      to,
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
