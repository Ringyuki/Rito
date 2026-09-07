import 'display_geometry.dart';
import 'display_paint.dart';

/// The text run body the `RITODL1` text and ruby primitives carry: every
/// length is in CSS pixels, painted under the list's ratio.
/// Where one cluster of a run paints: the origin of the cluster starting
/// at [byte] of the run's text, in CSS pixels, spacing and justification
/// already applied.
final class RitoClusterPosition {
  const RitoClusterPosition({required this.byte, required this.x});

  final int byte;
  final double x;
}

sealed class RitoTextPaintCommand {
  const RitoTextPaintCommand({
    required this.text,
    required this.rect,
    required this.paint,
    this.lineHeightPx,
    this.href,
    this.sourceText,
    this.sourceTextOffset,
    this.rubyAlign,
    this.alignRight = false,
    this.vertical = false,
    this.clusters = const <RitoClusterPosition>[],
  });

  final String text;
  final RitoDisplayRect rect;
  final RitoRunPaint paint;
  final double? lineHeightPx;
  final String? href;
  final String? sourceText;
  final int? sourceTextOffset;

  /// The annotation's computed `ruby-align` keyword, when the engine
  /// sends one (wire tail field added with the ruby-align law).
  final String? rubyAlign;

  /// Right-aligned draw: `rect.x` is the text's right edge and the pen
  /// measures the string to place itself (outside list markers).
  final bool alignRight;

  /// Vertical writing: one downward column, `rect.x` its left edge and
  /// `rect.y` the first glyph's top.
  final bool vertical;

  /// The origin of every cluster in text order; empty when the pen still
  /// places the run itself (a right-aligned marker, a vertical column, an
  /// annotation).
  final List<RitoClusterPosition> clusters;
}

final class RitoPaintText extends RitoTextPaintCommand {
  const RitoPaintText({
    required super.text,
    required super.rect,
    required super.paint,
    super.lineHeightPx,
    super.href,
    super.sourceText,
    super.sourceTextOffset,
    super.rubyAlign,
    super.alignRight,
    super.vertical,
    super.clusters,
  });
}

final class RitoPaintRuby extends RitoTextPaintCommand {
  const RitoPaintRuby({
    required super.text,
    required super.rect,
    required super.paint,
    super.lineHeightPx,
    super.href,
    super.sourceText,
    super.sourceTextOffset,
    super.rubyAlign,
    super.alignRight,
    super.vertical,
    super.clusters,
  });
}
