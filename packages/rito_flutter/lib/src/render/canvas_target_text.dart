part of 'canvas_target.dart';

extension _TextPainting on RitoPrimitiveCanvasTarget {
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
    if (command.clusters.isNotEmpty) {
      _paintClusteredRun(command, rect, ruby: ruby);
      return;
    }
    // The run's inline box and decoration line arrive as primitives of
    // their own; the pen paints shadows, then glyphs.
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
  }

  /// A run whose clusters the engine placed: every cluster draws at its
  /// own origin. A text run's origin is its alphabetic baseline, already
  /// on a device row; an annotation's origin is its em-box top (the
  /// browser pen's textBaseline 'top'), which the font envelope's top
  /// anchor turns into a whole baseline row. Spacing, justification,
  /// ruby distribution, column stepping and the browser's fixed-point
  /// advances are already in the origins, so the paragraphs carry no
  /// spacing and one laid-out paragraph per (cluster, style) serves every
  /// paint — laying each cluster out per paint costs twenty times what
  /// a run does.
  void _paintClusteredRun(
    RitoTextPaintCommand command,
    ui.Rect rect, {
    bool ruby = false,
  }) {
    final paint = command.paint;
    final color = _effectiveTextColor(paint, rect);
    final topAscent = ruby
        ? _fontEnvelopes
              ?.lookupFamilyStack(paint.font.family)
              ?.topAnchorAscentPx(paint.font.sizePx)
        : null;
    final pieces = _clusterPieces(command.text, command.clusters);
    final placed = <(ui.Paragraph, ui.Offset)>[];
    for (final piece in pieces) {
      final paragraph = _clusterParagraph(piece.text, paint, color);
      final row = ruby
          ? (piece.y + (topAscent ?? paragraph.alphabeticBaseline))
                .roundToDouble()
          : piece.y;
      placed.add((
        paragraph,
        ui.Offset(piece.x, row - paragraph.alphabeticBaseline),
      ));
    }
    if (paint.textShadows.isNotEmpty) {
      _paintClusterShadows(pieces, paint, placed);
    }
    for (final (paragraph, origin) in placed) {
      _canvas.drawParagraph(paragraph, origin);
    }
  }

  /// One laid-out paragraph per (cluster text, font, colour), kept across
  /// paints; the map lives on the target, which a page surface keeps.
  ui.Paragraph _clusterParagraph(
    String text,
    RitoRunPaint paint,
    ui.Color color,
  ) {
    final font = paint.font;
    final key = (
      text,
      font.family,
      font.sizePx,
      font.weight,
      font.style == RitoFontStyle.italic,
      color.toARGB32(),
    );
    return _clusterParagraphs.putIfAbsent(key, () {
      return _buildClusterParagraph(text, paint, color: color);
    });
  }

  ui.Paragraph _buildClusterParagraph(
    String text,
    RitoRunPaint paint, {
    ui.Color? color,
    ui.Paint? foreground,
  }) {
    final font = paint.font;
    final families = ritoSplitFontFamilyStack(font.family);
    final builder =
        ui.ParagraphBuilder(
            ui.ParagraphStyle(
              fontFamily: families.isEmpty ? null : families.first,
              fontSize: font.sizePx,
              fontStyle: font.style == RitoFontStyle.italic
                  ? FontStyle.italic
                  : FontStyle.normal,
              fontWeight: _paintWeight(families, font.weight),
              maxLines: 1,
            ),
          )
          ..pushStyle(
            ui.TextStyle(
              color: color,
              foreground: foreground,
              fontFamily: families.isEmpty ? null : families.first,
              fontFamilyFallback: families.length > 1
                  ? families.sublist(1)
                  : null,
              fontSize: font.sizePx,
              fontStyle: font.style == RitoFontStyle.italic
                  ? FontStyle.italic
                  : FontStyle.normal,
              fontWeight: _paintWeight(families, font.weight),
            ),
          )
          ..addText(text);
    return builder.build()
      ..layout(const ui.ParagraphConstraints(width: double.infinity));
  }

  /// Shadow layers under the whole run, back to front, each one bitmap
  /// holding every cluster the way the browser blurs a run's mask at
  /// once: blurring each cluster on its own composited neighbouring
  /// glows over each other and read darker where they overlap.
  void _paintClusterShadows(
    List<({String text, double x, double y})> pieces,
    RitoRunPaint paint,
    List<(ui.Paragraph, ui.Offset)> placed,
  ) {
    var bounds = ui.Rect.zero;
    for (final (paragraph, origin) in placed) {
      final box = ui.Rect.fromLTWH(
        origin.dx,
        origin.dy,
        paragraph.longestLine,
        paragraph.height,
      );
      bounds = bounds == ui.Rect.zero ? box : bounds.expandToInclude(box);
    }
    var pad = 0.0;
    for (final shadow in paint.textShadows) {
      pad = math.max(
        pad,
        shadow.blur * 2 + math.max(shadow.offsetX.abs(), shadow.offsetY.abs()),
      );
    }
    final area = bounds.inflate(pad + 1);
    for (final shadow in paint.textShadows.reversed) {
      final layerPaint = ui.Paint();
      if (shadow.blur > 0) {
        layerPaint.imageFilter = ui.ImageFilter.blur(
          sigmaX: shadow.blur / 2,
          sigmaY: shadow.blur / 2,
        );
      }
      _canvas.saveLayer(area, layerPaint);
      try {
        final ink = ui.Paint()..color = _color(shadow.color);
        for (var index = 0; index < placed.length; index += 1) {
          final layer = _buildClusterParagraph(
            pieces[index].text,
            paint,
            foreground: ink,
          );
          _canvas.drawParagraph(
            layer,
            placed[index].$2.translate(shadow.offsetX, shadow.offsetY),
          );
        }
      } finally {
        _canvas.restore();
      }
    }
  }

  /// The run's text cut at its cluster origins: cluster boundaries are
  /// UTF-8 byte offsets, so the cut walks the runes counting their UTF-8
  /// lengths.
  static List<({String text, double x, double y})> _clusterPieces(
    String text,
    List<RitoClusterPosition> clusters,
  ) {
    final starts = <int, int>{};
    var byte = 0;
    var index = 0;
    for (final rune in text.runes) {
      starts[byte] = index;
      byte += rune < 0x80
          ? 1
          : rune < 0x800
          ? 2
          : rune < 0x10000
          ? 3
          : 4;
      index += rune >= 0x10000 ? 2 : 1;
    }
    starts[byte] = index;
    final pieces = <({String text, double x, double y})>[];
    for (var at = 0; at < clusters.length; at += 1) {
      final start = starts[clusters[at].byte];
      final end = at + 1 < clusters.length
          ? starts[clusters[at + 1].byte]
          : text.length;
      if (start == null || end == null || end <= start) {
        continue;
      }
      pieces.add((
        text: text.substring(start, end),
        x: clusters[at].x,
        y: clusters[at].y,
      ));
    }
    return pieces;
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
  /// (R2): a declared ground — the run's own inline band (an opaque fill
  /// lowered just before the run), an opaque block fill containing the
  /// run, or a book-owned page ground — means
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
      declaredGround: runRect == null ? null : _declaredGroundFor(runRect),
    );
    // _color already carries the opacity stack; a theme substitution
    // must re-apply it (the browser pen's globalAlpha does this).
    return identical(effective, color)
        ? color
        : effective.withValues(alpha: effective.a * _opacity);
  }

  /// The ground a run's ink was typeset against, when the book
  /// expressed one: the nearest opaque fill containing the run's rect —
  /// the run's own inline band lowers to such a fill just before the
  /// run — else the page ground R1 kept for the book. Null means the
  /// theme supplies the ground. Mirrors the browser pen's
  /// declaredGroundFor. The run's rect is in CSS pixels and the declared
  /// grounds are device rects, so the containment test scales the run.
  ui.Color? _declaredGroundFor(ui.Rect runRect) {
    final rect = _ratio == 1
        ? runRect
        : ui.Rect.fromLTWH(
            runRect.left * _ratio,
            runRect.top * _ratio,
            runRect.width * _ratio,
            runRect.height * _ratio,
          );
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

  void _validateRunPaint(RitoRunPaint paint) {
    for (final shadow in paint.textShadows) {
      if (shadow.blur < 0) {
        throw const RitoWireException(
          'RITODL1 text-shadow blur radius must not be negative.',
        );
      }
    }
  }
}
