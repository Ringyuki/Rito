import 'display_color.dart';

final class RitoFontStyle {
  const RitoFontStyle._(this.name);

  final String name;

  static const RitoFontStyle normal = RitoFontStyle._('normal');
  static const RitoFontStyle italic = RitoFontStyle._('italic');
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

/// The paint a text run carries: what the pen needs to raster its glyphs.
/// The run's inline box (background band, padding, borders) and its
/// decoration line lower to primitives around the run in the engine.
final class RitoRunPaint {
  RitoRunPaint({
    required this.font,
    required this.color,
    required List<RitoTextShadow> textShadows,
  }) : textShadows = List<RitoTextShadow>.unmodifiable(textShadows);

  final RitoFontPaint font;
  final RitoColor color;
  final List<RitoTextShadow> textShadows;
}
