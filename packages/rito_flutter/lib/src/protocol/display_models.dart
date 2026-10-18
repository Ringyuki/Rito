import 'display_geometry.dart';
import 'display_paint.dart';

/// Where one cluster of a run paints: the origin of the cluster starting
/// at [byte] of the run's UTF-8 text, in CSS pixels at float32 (the
/// precision a canvas takes it at) with spacing and justification already
/// applied — [y] is the alphabetic baseline, for a text run and an
/// annotation alike — and whether a pen drawing one string from the
/// previous cluster's origin puts this cluster there ([joins]).
final class RitoClusterPosition {
  const RitoClusterPosition({
    required this.byte,
    required this.x,
    required this.y,
    this.joins = false,
  });

  final int byte;
  final double x;
  final double y;
  final bool joins;
}

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
