part of 'canvas_target.dart';

extension _TextPainting on RitoCanvasPaintTarget {
  void _paintText(RitoPaintText command) {
    _paintStringRun(command, ruby: false);
  }

  void _paintRuby(RitoPaintRuby command) {
    _paintStringRun(command, ruby: true);
  }

  void _paintStringRun(RitoTextPaintCommand command, {required bool ruby}) {
    final rect = _rect(command.rect);
    _validateRunPaint(command.paint);
    _paintInlineBackground(rect, command.paint);
    final painter = TextPainter(
      text: TextSpan(
        text: command.text,
        style: _textStyle(command.paint, command.lineHeightPx),
      ),
      textDirection: ui.TextDirection.ltr,
      maxLines: 1,
    )..layout();
    final x = ruby ? rect.left + (rect.width - painter.width) / 2 : rect.left;
    painter.paint(_canvas, ui.Offset(x, rect.top));
    _paintDecoration(rect, command.paint.decoration);
    _paintRunBorders(rect, command.paint.border);
  }

  TextStyle _textStyle(RitoRunPaint paint, double? lineHeightPx) {
    final font = paint.font;
    return TextStyle(
      color: _color(paint.color),
      fontFamily: font.family.isEmpty ? null : font.family,
      fontSize: font.sizePx,
      fontStyle: font.style == RitoFontStyle.italic
          ? FontStyle.italic
          : FontStyle.normal,
      fontWeight: _fontWeight(font.weight),
      wordSpacing: paint.wordSpacingPx,
      letterSpacing: paint.letterSpacingPx,
      height: lineHeightPx == null || font.sizePx == 0
          ? null
          : lineHeightPx / font.sizePx,
      shadows: paint.textShadows.isEmpty
          ? null
          : <ui.Shadow>[
              for (final shadow in paint.textShadows) _textShadow(shadow),
            ],
    );
  }

  FontWeight _fontWeight(double value) {
    final index = ((value / 100).round() - 1).clamp(0, 8).toInt();
    return FontWeight.values[index];
  }

  ui.Shadow _textShadow(RitoTextShadow shadow) {
    return ui.Shadow(
      color: _color(shadow.color),
      blurRadius: shadow.blur,
      offset: ui.Offset(shadow.offsetX, shadow.offsetY),
    );
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
