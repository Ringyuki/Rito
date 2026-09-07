import 'display_color.dart';

final class RitoFontStyle {
  const RitoFontStyle._(this.name);

  final String name;

  static const RitoFontStyle normal = RitoFontStyle._('normal');
  static const RitoFontStyle italic = RitoFontStyle._('italic');
}

final class RitoBorderStyle {
  const RitoBorderStyle._(this.name);

  final String name;

  static const RitoBorderStyle none = RitoBorderStyle._('none');
  static const RitoBorderStyle hidden = RitoBorderStyle._('hidden');
  static const RitoBorderStyle dotted = RitoBorderStyle._('dotted');
  static const RitoBorderStyle dashed = RitoBorderStyle._('dashed');
  static const RitoBorderStyle solid = RitoBorderStyle._('solid');
  static const RitoBorderStyle double = RitoBorderStyle._('double');
  static const RitoBorderStyle groove = RitoBorderStyle._('groove');
  static const RitoBorderStyle ridge = RitoBorderStyle._('ridge');
  static const RitoBorderStyle inset = RitoBorderStyle._('inset');
  static const RitoBorderStyle outset = RitoBorderStyle._('outset');
}

final class RitoRunDecorationKind {
  const RitoRunDecorationKind._(this.name);

  final String name;

  static const RitoRunDecorationKind underline = RitoRunDecorationKind._(
    'underline',
  );
  static const RitoRunDecorationKind lineThrough = RitoRunDecorationKind._(
    'line-through',
  );
}

final class RitoBorderEdgePaint {
  const RitoBorderEdgePaint({required this.color, required this.style});

  final RitoColor color;
  final RitoBorderStyle style;
}

final class RitoFontPaint {
  const RitoFontPaint({
    required this.family,
    required this.sizePx,
    required this.weight,
    required this.style,
  });

  final String family;
  final double sizePx;
  final double weight;
  final RitoFontStyle style;
}

final class RitoTextShadow {
  const RitoTextShadow({
    required this.offsetX,
    required this.offsetY,
    required this.blur,
    required this.color,
  });

  final double offsetX;
  final double offsetY;
  final double blur;
  final RitoColor color;
}

final class RitoRunDecoration {
  const RitoRunDecoration({
    required this.kind,
    required this.y,
    required this.thickness,
    required this.color,
  });

  final RitoRunDecorationKind kind;
  final double y;
  final double thickness;
  final RitoColor color;
}

final class RitoSpacing {
  const RitoSpacing({
    required this.top,
    required this.right,
    required this.bottom,
    required this.left,
  });

  final double top;
  final double right;
  final double bottom;
  final double left;
}

final class RitoRunBorderEdge {
  const RitoRunBorderEdge({required this.widthPx, required this.paint});

  final double widthPx;
  final RitoBorderEdgePaint paint;
}

final class RitoRunBorder {
  const RitoRunBorder({this.top, this.bottom, this.start, this.end});

  final RitoRunBorderEdge? top;
  final RitoRunBorderEdge? bottom;
  final RitoRunBorderEdge? start;
  final RitoRunBorderEdge? end;
}

final class RitoRunPaint {
  RitoRunPaint({
    required this.font,
    required this.color,
    this.wordSpacingPx,
    this.letterSpacingPx,
    this.backgroundColor,
    this.backgroundRadius,
    required List<RitoTextShadow> textShadows,
    this.decoration,
    this.padding,
    this.border,
    this.boxTopPx,
    this.boxBottomPx,
    this.boxStart = true,
    this.boxEnd = true,
  }) : textShadows = List<RitoTextShadow>.unmodifiable(textShadows);

  final RitoFontPaint font;
  final RitoColor color;
  final double? wordSpacingPx;
  final double? letterSpacingPx;
  final RitoColor? backgroundColor;
  final double? backgroundRadius;
  final List<RitoTextShadow> textShadows;
  final RitoRunDecoration? decoration;
  final RitoSpacing? padding;
  final RitoRunBorder? border;

  /// Engine-computed inline box top/bottom relative to the run rect top;
  /// null when the run carries no box paint (extents then derive from
  /// font metrics).
  final double? boxTopPx;
  final double? boxBottomPx;

  /// Whether this run opens/closes its inline box. A run split across
  /// lines squares the split ends: rounding and start/end borders apply
  /// only where the box actually opens or closes.
  final bool boxStart;
  final bool boxEnd;
}
