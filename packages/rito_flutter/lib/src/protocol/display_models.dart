import 'display_geometry.dart';
import 'display_paint.dart';

/// The text run body the `RITODL1` text and ruby primitives carry: every
/// length is in CSS pixels, painted under the list's ratio.
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
  });
}
