import 'dart:typed_data';

import 'display_geometry.dart';
import 'display_paint.dart';

/// Where every cluster of a run paints, in text order: cluster `i` starts
/// at byte `bytes[i]` of the run's UTF-8 text and paints with its origin
/// at (`origins[2i]`, `origins[2i + 1]`) in CSS pixels at float32 (the
/// precision a canvas takes it at), spacing and justification already
/// applied — the y is the alphabetic baseline, for a text run and an
/// annotation alike. `joins[i]` is 1 where a pen drawing one string from
/// the previous cluster's origin puts cluster `i` there. A decoded list's
/// runs share the table these are views of: read them, never write them.
final class RitoClusters {
  RitoClusters({
    required this.bytes,
    required this.origins,
    required this.joins,
  });

  RitoClusters.empty()
    : bytes = Uint32List(0),
      origins = Float32List(0),
      joins = Uint8List(0);

  final Uint32List bytes;
  final Float32List origins;
  final Uint8List joins;

  int get length => bytes.length;
  bool get isEmpty => bytes.isEmpty;
  bool get isNotEmpty => bytes.isNotEmpty;
}

/// The text run body the `RITODL1` text and ruby primitives carry: every
/// length is in CSS pixels, painted under the list's ratio.
sealed class RitoTextPaintCommand {
  RitoTextPaintCommand({
    required this.text,
    required this.rect,
    required this.paint,
    this.lineHeightPx,
    this.href,
    this.sourceText,
    this.sourceTextOffset,
    RitoClusters? clusters,
  }) : clusters = clusters ?? RitoClusters.empty();

  final String text;
  final RitoDisplayRect rect;
  final RitoRunPaint paint;
  final double? lineHeightPx;
  final String? href;
  final String? sourceText;
  final int? sourceTextOffset;

  /// The origin of every cluster in text order; empty only for a run the
  /// pen still places itself.
  final RitoClusters clusters;
}

final class RitoPaintText extends RitoTextPaintCommand {
  RitoPaintText({
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
  RitoPaintRuby({
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
