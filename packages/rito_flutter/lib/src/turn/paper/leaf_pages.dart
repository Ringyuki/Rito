import 'package:flutter_gpu/gpu.dart' as gpu;

import 'model.dart';

/// What of a paper turn is the host's (kit `leaf-pages.ts`): the pages the
/// leaves in the air show. The model names the leaves and tells which pages
/// the led leaf shows now; their textures are kept here by those names,
/// taken when a leaf is led and let go when it leaves the book or is
/// forgotten. A leaf left alone keeps the pages it was given.
final class PaperLeafPages {
  final _numbers = Expando<int>();
  var _counted = 0;
  final _leaves = <int, ({gpu.Texture? front, gpu.Texture? after})>{};

  /// A page as the model knows it: its spread, and a number for what holds
  /// it, the same while what holds it is painted again.
  RitoPaperTurnPage? named(Object? holder, int? spread) {
    if (holder == null || spread == null) return null;
    var number = _numbers[holder];
    if (number == null) {
      _counted += 1;
      number = _numbers[holder] = _counted;
    }
    return RitoPaperTurnPage(spread: spread, buffer: number);
  }

  void forget(RitoPaperTurnForgotten forgotten) {
    forgotten.leaves.forEach(_leaves.remove);
  }

  /// Lets the leaves that left the book go, and gives the led leaf the
  /// frame's pages: [textures] by the number of what holds each page.
  void lay(RitoPaperTurnLaid laid, Map<int, gpu.Texture?> textures) {
    laid.leftBook.forEach(_leaves.remove);
    gpu.Texture? of(RitoPaperTurnPage? page) =>
        page == null ? null : textures[page.buffer];
    _leaves[laid.led] = (front: of(laid.front), after: of(laid.after));
  }

  /// The page a face of a sheet shows; null for bare paper.
  gpu.Texture? face(RitoPaperTurnFace? face) {
    if (face == null) return null;
    final shown = _leaves[face.leaf];
    return face.front ? shown?.front : shown?.after;
  }
}
