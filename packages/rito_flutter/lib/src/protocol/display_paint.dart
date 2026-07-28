import 'display_color.dart';
import 'display_geometry.dart';

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

final class RitoBackgroundSize {
  const RitoBackgroundSize._(this.name);

  final String name;

  static const RitoBackgroundSize auto = RitoBackgroundSize._('auto');
  static const RitoBackgroundSize cover = RitoBackgroundSize._('cover');
  static const RitoBackgroundSize contain = RitoBackgroundSize._('contain');
}

final class RitoBackgroundRepeat {
  const RitoBackgroundRepeat._(this.name);

  final String name;

  static const RitoBackgroundRepeat repeat = RitoBackgroundRepeat._('repeat');
  static const RitoBackgroundRepeat noRepeat = RitoBackgroundRepeat._(
    'no-repeat',
  );
  static const RitoBackgroundRepeat repeatX = RitoBackgroundRepeat._(
    'repeat-x',
  );
  static const RitoBackgroundRepeat repeatY = RitoBackgroundRepeat._(
    'repeat-y',
  );
  static const RitoBackgroundRepeat space = RitoBackgroundRepeat._('space');
  static const RitoBackgroundRepeat round = RitoBackgroundRepeat._('round');
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

final class RitoBackgroundPosition {
  const RitoBackgroundPosition({required this.x, required this.y});

  final RitoLength x;
  final RitoLength y;
}

final class RitoBackgroundPaint {
  const RitoBackgroundPaint({
    this.color,
    this.image,
    this.size,
    this.repeat,
    this.position,
  });

  final RitoColor? color;
  final String? image;
  final RitoBackgroundSize? size;
  final RitoBackgroundRepeat? repeat;
  final RitoBackgroundPosition? position;
}

final class RitoBorderEdgePaint {
  const RitoBorderEdgePaint({required this.color, required this.style});

  final RitoColor color;
  final RitoBorderStyle style;
}

final class RitoBlockBorder {
  const RitoBlockBorder({this.top, this.right, this.bottom, this.left});

  final RitoBorderEdgePaint? top;
  final RitoBorderEdgePaint? right;
  final RitoBorderEdgePaint? bottom;
  final RitoBorderEdgePaint? left;
}

sealed class RitoBlockRadius {
  const RitoBlockRadius();
}

final class RitoBlockPxRadius extends RitoBlockRadius {
  const RitoBlockPxRadius(this.value);

  final double value;
}

final class RitoBlockPercentRadius extends RitoBlockRadius {
  const RitoBlockPercentRadius(this.value);

  final double value;
}

/// Circular per-corner radii in CSS order (top-left, top-right,
/// bottom-right, bottom-left) for boxes whose corners disagree.
final class RitoBlockCornersRadius extends RitoBlockRadius {
  RitoBlockCornersRadius(List<double> corners)
    : corners = List<double>.unmodifiable(corners);

  final List<double> corners;
}

final class RitoBoxShadow {
  const RitoBoxShadow({
    required this.offsetX,
    required this.offsetY,
    required this.blur,
    required this.spread,
    required this.color,
    required this.inset,
  });

  final double offsetX;
  final double offsetY;
  final double blur;
  final double spread;
  final RitoColor color;
  final bool inset;
}

final class RitoBlockPaint {
  RitoBlockPaint({
    this.background,
    this.border,
    this.radius,
    required List<RitoBoxShadow> boxShadows,
  }) : boxShadows = List<RitoBoxShadow>.unmodifiable(boxShadows);

  final RitoBackgroundPaint? background;
  final RitoBlockBorder? border;
  final RitoBlockRadius? radius;
  final List<RitoBoxShadow> boxShadows;
}

final class RitoBorderBox {
  const RitoBorderBox({
    required this.topWidth,
    required this.rightWidth,
    required this.bottomWidth,
    required this.leftWidth,
  });

  final double topWidth;
  final double rightWidth;
  final double bottomWidth;
  final double leftWidth;
}

final class RitoPagePaint {
  const RitoPagePaint({this.backgroundColor});

  final RitoColor? backgroundColor;
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
}

final class RitoHorizontalRulePaint {
  const RitoHorizontalRulePaint({required this.color, required this.style});

  final RitoColor color;
  final RitoBorderStyle style;
}
