import 'dart:math' as math;
import 'dart:ui' as ui;

/// Host theme override for the Canvas pen, mirroring the browser pen's
/// colorOverride: the theme background owns the page ground (the engine
/// materializes the book's own body background, which would otherwise
/// bury a dark/sepia theme), and run text keeps its original color only
/// while it stays WCAG-readable against the theme background —
/// otherwise it snaps to the theme foreground.
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

  /// Returns [original] when it stays readable on [background],
  /// otherwise the theme [foreground].
  ui.Color effectiveTextColor(ui.Color original) {
    return _contrastRatio(original, background) >= _normalTextThreshold
        ? original
        : foreground;
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
}
