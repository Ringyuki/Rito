import 'display_geometry.dart';
import 'display_paint.dart';

/// The text run body the `RITODL1` text and ruby primitives carry: every
/// length is in CSS pixels, painted under the list's ratio.
/// Where one cluster of a run paints: the origin of the cluster starting
/// at [byte] of the run's text, in CSS pixels, spacing and justification
/// already applied.
/// Where one cluster of a run paints: the origin of the cluster starting
/// at [byte] of the run's UTF-8 text — [y] is the alphabetic baseline of
/// a text run, the em-box top of an annotation.
final class RitoClusterPosition {
  const RitoClusterPosition({
    required this.byte,
    required this.x,
    required this.y,
  });

  final int byte;
  final double x;
  final double y;
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
    this.clusters = const <RitoClusterPosition>[],
  });

  final String text;
  final RitoDisplayRect rect;
  final RitoRunPaint paint;
  final double? lineHeightPx;
  final String? href;
  final String? sourceText;
  final int? sourceTextOffset;

  /// The origin of every cluster in text order; empty only for a run the
  /// pen still places itself.
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
    super.clusters,
  });
}
