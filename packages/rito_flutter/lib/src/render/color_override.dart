import 'dart:math' as math;
import 'dart:ui' as ui;

/// Host theme override for the Canvas pen, mirroring the browser pen's
/// colorOverride. The override does exactly one thing: where the book
/// expressed no opinion (it assumed white paper), it supplies the
/// theme's ground and re-inks the text. Wherever the book declared a
/// ground itself, the foreground/background pair was the typesetter's
/// choice and stays untouched.
final class RitoCanvasColorOverride {
  const RitoCanvasColorOverride({
    required this.foreground,
    required this.background,
  });

  final ui.Color foreground;
  final ui.Color background;

  /// WCAG contrast threshold for normal body text, matching the browser
  /// pen's resolveTextColor default.
  static const double _normalTextThreshold = 4.5;

  /// Saturation at or below which ink counts as achromatic and lands
  /// exactly on the theme foreground (bit-identical for black/white/
  /// gray, the overwhelmingly common case).
  static const double _achromaticSaturationLimit = 0.05;

  /// Page grounds darker than this relative luminance are a designed
  /// choice the book expressed; lighter ones are the typesetter's
  /// white-paper default assumption that the theme takes over.
  static const double _bookGroundLuminanceLimit = 0.75;

  /// True when a page background is the book's own designed ground
  /// (R1): fully opaque and darker than the white-paper limit.
  static bool isBookOwnedPageGround(ui.Color color) {
    return color.a >= 1 && _relativeLuminance(color) < _bookGroundLuminanceLimit;
  }

  /// Resolves the ink for a run whose effective ground is
  /// [declaredGround] when the book expressed one, or the theme
  /// background when it did not.
  ///
  /// A declared ground returns [original] unchanged (R2). On the theme
  /// ground, readable ink stays; unreadable ink keeps its hue and
  /// saturation and moves only in lightness to the theme foreground's
  /// (R3) — achromatic ink lands exactly on the theme foreground.
  ui.Color effectiveTextColor(ui.Color original, {ui.Color? declaredGround}) {
    if (declaredGround != null) {
      return original;
    }
    if (_contrastRatio(original, background) >= _normalTextThreshold) {
      return original;
    }
    final (hue, saturation, _) = _rgbToHsl(original);
    if (saturation <= _achromaticSaturationLimit) {
      return foreground;
    }
    final (_, _, themeLightness) = _rgbToHsl(foreground);
    final relit = _hslToRgb(hue, saturation * 100, themeLightness * 100);
    // A theme whose own foreground cannot carry this hue readably falls
    // back to the exact foreground rather than shipping unreadable ink.
    if (_contrastRatio(relit, background) < _normalTextThreshold) {
      return foreground;
    }
    return relit;
  }

  static double _contrastRatio(ui.Color first, ui.Color second) {
    final one = _relativeLuminance(first);
    final two = _relativeLuminance(second);
    final lighter = math.max(one, two);
    final darker = math.min(one, two);
    return (lighter + 0.05) / (darker + 0.05);
  }

  static double _relativeLuminance(ui.Color color) {
    double channel(double value) => value <= 0.03928
        ? value / 12.92
        : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(color.r) +
        0.7152 * channel(color.g) +
        0.0722 * channel(color.b);
  }

  /// The browser pen computes in quantized 0-255 channels (the engine
  /// serializes opaque colors as #rrggbb); quantize before HSL so the
  /// relit channels match it bit for bit.
  static (double, double, double) _rgbToHsl(ui.Color color) {
    final r = (color.r * 255).round() / 255;
    final g = (color.g * 255).round() / 255;
    final b = (color.b * 255).round() / 255;
    final maxChannel = math.max(r, math.max(g, b));
    final minChannel = math.min(r, math.min(g, b));
    final lightness = (maxChannel + minChannel) / 2;
    if (maxChannel == minChannel) {
      return (0, 0, lightness);
    }
    final delta = maxChannel - minChannel;
    final saturation = lightness > 0.5
        ? delta / (2 - maxChannel - minChannel)
        : delta / (maxChannel + minChannel);
    double hue;
    if (maxChannel == r) {
      hue = (g - b) / delta + (g < b ? 6 : 0);
    } else if (maxChannel == g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    return (hue * 60, saturation, lightness);
  }

  /// Mirrors the browser pen's hslToRgb (h in degrees, s and l in
  /// 0-100) including its rounding, so both pens relight to identical
  /// channels.
  static ui.Color _hslToRgb(double h, double s, double l) {
    final hue = ((h % 360) + 360) % 360;
    final sat = (s / 100).clamp(0.0, 1.0);
    final lit = (l / 100).clamp(0.0, 1.0);
    final chroma = (1 - (2 * lit - 1).abs()) * sat;
    final second = chroma * (1 - (((hue / 60) % 2) - 1).abs());
    final match = lit - chroma / 2;
    double red;
    double green;
    double blue;
    if (hue < 60) {
      (red, green, blue) = (chroma, second, 0.0);
    } else if (hue < 120) {
      (red, green, blue) = (second, chroma, 0.0);
    } else if (hue < 180) {
      (red, green, blue) = (0.0, chroma, second);
    } else if (hue < 240) {
      (red, green, blue) = (0.0, second, chroma);
    } else if (hue < 300) {
      (red, green, blue) = (second, 0.0, chroma);
    } else {
      (red, green, blue) = (chroma, 0.0, second);
    }
    return ui.Color.fromARGB(
      255,
      ((red + match) * 255).round(),
      ((green + match) * 255).round(),
      ((blue + match) * 255).round(),
    );
  }
}
