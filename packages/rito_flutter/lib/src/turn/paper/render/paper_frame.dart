import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_gpu/gpu.dart' as gpu;
import '../model.dart';

/// One sheet of the book as a frame shows it (the web's `PaperSheet`).
final class PaperSheet {
  PaperSheet({
    required this.positions,
    required this.normals,
    required this.front,
    required this.back,
    required this.shown,
    this.curl,
    this.still = false,
  });

  /// x, y, z of a grid of points over the sheet, row by row from the spine outward.
  final Float32List positions;
  final Float32List normals;
  final gpu.Texture? front;
  final gpu.Texture? back;
  final double shown;
  final RitoPaperTurnCurl? curl;
  final bool still;
}

/// One frame: the sheets from the front of the book to the back.
final class PaperFrame {
  PaperFrame({
    required this.width,
    required this.height,
    required this.spine,
    required this.columns,
    required this.rows,
    required this.eye,
    required this.sheets,
    required this.paper,
  });

  final double width;
  final double height;
  final double spine;
  final int columns;
  final int rows;
  final double eye;
  final List<PaperSheet> sheets;
  final List<double> paper;
}

/// What of a sheet is drawn: all of it, what lies on the pages, or what stands off them.
enum SheetPart { whole, lying, lifted }

double partOf(SheetPart part) => switch (part) {
  SheetPart.whole => 0,
  SheetPart.lying => 1,
  SheetPart.lifted => -1,
};

/// A sheet standing less than this above the pages casts no shadow.
const double _lying = 0.5;

/// How far apart sheets lying on each other are told to the depth test.
const double _sheetApart = 0.05;

double tallestOf(Float32List positions) {
  var tallest = 0.0;
  for (var index = 2; index < positions.length; index += 3) {
    tallest = math.max(tallest, positions[index]);
  }
  return tallest;
}

bool liesOnThePages(PaperSheet sheet) => tallestOf(sheet.positions) <= _lying;

/// How far a sheet is lifted for the depth test alone (draw-sheet.ts `liftOf`).
({double lying, double turned}) liftOf(PaperFrame frame, int index) {
  final sheet = frame.sheets[index];
  final behind = frame.sheets.length - 1 - index;
  if (sheet.curl != null) {
    return (
      lying: _sheetApart * behind,
      turned: _sheetApart * (index - behind),
    );
  }
  final shown = sheet.shown;
  return (
    lying: _sheetApart * ((1 - shown) * behind + shown * index),
    turned: 0,
  );
}

/// Whether a sheet's rows are drawn from the bottom up (draw-sheet.ts `paperBeneathFirst`).
bool fromBelow(PaperSheet sheet, SheetPart part) =>
    part == SheetPart.lifted && (sheet.curl?.dy ?? 0) < 0;

const List<double> _profile = [0.03, 0.25, 0.6, 1];

/// How high the leaf stands at most, and its shape in eight rows of four
/// points (draw-sheet.ts `outline`).
({double tallest, Float32List profile}) outline(
  PaperFrame frame,
  Float32List positions,
) {
  final profile = Float32List(8 * _profile.length * 3);
  for (var line = 0; line < 8; line += 1) {
    final row = ((line / 7) * (frame.rows - 1)).round();
    for (var point = 0; point < _profile.length; point += 1) {
      final at =
          (row * frame.columns +
              (_profile[point] * (frame.columns - 1)).round()) *
          3;
      profile.setRange(
        (line * _profile.length + point) * 3,
        (line * _profile.length + point) * 3 + 3,
        positions,
        at,
      );
    }
  }
  return (tallest: math.max(1.0, tallestOf(positions)), profile: profile);
}

/// How far this side of its line a curled page's paper already hides the pages.
const double _onTheLine = 0.5;

/// From where a sheet's paper hides the pages (shadow.ts `hidesFrom`).
List<double> hidesFrom(RitoPaperTurnCurl? curl) =>
    curl == null ? [0, 0, -1] : [curl.dx, curl.dy, curl.at - _onTheLine];

/// Where the spine falls across what a shadow is worked out in (shadow-targets.ts `sidesOf`).
({double spine, double edge, double left, double right}) sidesOf(
  double spine,
  double width,
  int texels,
) {
  final edge = ((spine / width) * texels).round();
  return (
    spine: spine / width,
    edge: edge / texels,
    left: (edge - 0.5) / texels,
    right: (edge + 0.5) / texels,
  );
}
