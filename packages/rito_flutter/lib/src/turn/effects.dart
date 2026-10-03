import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

/// The pages a turn can show: the one on screen and its neighbours.
enum RitoPageSlot { previous, current, next }

/// One frame of a page turn as an effect sees it: how far the turn has
/// travelled ([offset], logical px, negative while turning forward), the
/// page width, and which neighbour is coming in (null while pulling
/// against the first or last page).
final class RitoPageTurnFrame {
  const RitoPageTurnFrame({
    required this.offset,
    required this.width,
    required this.incoming,
  });

  final double offset;
  final double width;
  final RitoPageSlot? incoming;

  /// How far the page has moved toward [incoming]: 0 at rest, 1 on arrival.
  double get progress {
    if (width <= 0 || incoming == null) return 0;
    final toward = incoming == RitoPageSlot.next ? -offset : offset;
    return math.min(1, math.max(0, toward / width));
  }
}

/// The page images a frame is painted from.
abstract interface class RitoPageTurnPages {
  /// Device pixels per logical pixel of every image.
  double get pixelRatio;

  /// The page in [slot], or null while it is not painted yet.
  ui.Image? image(RitoPageSlot slot);

  /// How far a page that arrived late has faded in (0–1); a painted effect
  /// multiplies its own opacity by it.
  double reveal(RitoPageSlot slot);
}

/// Where an effect paints one frame: the canvas, already filled with
/// [background], the page images, and a helper that draws a page whole.
final class RitoPageTurnScene {
  RitoPageTurnScene({
    required this.canvas,
    required this.size,
    required this.pages,
    required this.background,
  });

  final Canvas canvas;
  final Size size;
  final RitoPageTurnPages pages;

  /// The paper colour: what an effect shows where no page is.
  final Color background;

  /// Draws the page in [slot] at [x], scaled to the frame; a page not
  /// painted yet is skipped.
  void drawPage(RitoPageSlot slot, double x, {double opacity = 1}) {
    final image = pages.image(slot);
    final alpha = (opacity * pages.reveal(slot)).clamp(0.0, 1.0);
    if (image == null || alpha <= 0) return;
    final source = Rect.fromLTWH(
      0,
      0,
      image.width.toDouble(),
      image.height.toDouble(),
    );
    final paint = Paint()
      ..filterQuality = FilterQuality.medium
      ..color = Color.fromRGBO(255, 255, 255, alpha);
    canvas.drawImageRect(image, source, Offset(x, 0) & size, paint);
  }
}

/// How a page turn looks. The motion — the spring, the drag, the commit
/// decision and the rubber band at the ends — is the same for every
/// effect; an effect only paints what a frame shows at a displacement.
///
/// Paint the frame directly for looks that bend or cut the pages (a curl),
/// or extend [RitoLayeredPageTurnEffect] to lay whole pages over each
/// other.
abstract class RitoPageTurnEffect {
  const RitoPageTurnEffect();

  /// A turn lands at once instead of animating (a drag still decides
  /// whether it turns).
  bool get instant => false;

  void paint(RitoPageTurnScene scene, RitoPageTurnFrame frame);
}

/// The edge of a sheet lying over the page beneath it, which casts a soft
/// shadow on that page.
enum RitoPageEdge { left, right }

/// One whole page drawn for a frame.
final class RitoPageTurnLayer {
  const RitoPageTurnLayer(this.slot, this.x, {this.opacity = 1, this.shadow});

  final RitoPageSlot slot;
  final double x;
  final double opacity;
  final RitoPageEdge? shadow;

  @override
  bool operator ==(Object other) =>
      other is RitoPageTurnLayer &&
      other.slot == slot &&
      other.x == x &&
      other.opacity == opacity &&
      other.shadow == shadow;

  @override
  int get hashCode => Object.hash(slot, x, opacity, shadow);

  @override
  String toString() => 'RitoPageTurnLayer($slot, $x, $opacity, $shadow)';
}

/// An effect made of whole pages laid over each other.
abstract class RitoLayeredPageTurnEffect extends RitoPageTurnEffect {
  const RitoLayeredPageTurnEffect();

  /// The pages to draw, bottom to top.
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame);

  @override
  void paint(RitoPageTurnScene scene, RitoPageTurnFrame frame) {
    for (final layer in layers(frame)) {
      if (layer.opacity <= 0 || scene.pages.image(layer.slot) == null) {
        continue;
      }
      final shadow = layer.shadow;
      if (shadow != null) {
        final edge = shadow == RitoPageEdge.left
            ? layer.x
            : layer.x + scene.size.width;
        _paintEdgeShadow(scene.canvas, edge, shadow, scene.size.height);
      }
      scene.drawPage(layer.slot, layer.x, opacity: layer.opacity);
    }
  }
}

void _paintEdgeShadow(
  Canvas canvas,
  double edge,
  RitoPageEdge side,
  double height,
) {
  const reach = 24.0;
  final to = side == RitoPageEdge.left ? edge - reach : edge + reach;
  final paint = Paint()
    ..shader = ui.Gradient.linear(Offset(edge, 0), Offset(to, 0), const [
      Color.fromRGBO(0, 0, 0, 0.18),
      Color.fromRGBO(0, 0, 0, 0),
    ]);
  canvas.drawRect(
    Rect.fromLTRB(math.min(edge, to), 0, math.max(edge, to), height),
    paint,
  );
}

/// The built-in effects, the same as the web reader's.
abstract final class RitoPageTurnEffects {
  /// The page moves with the turn; the neighbour follows edge to edge.
  static const RitoLayeredPageTurnEffect slide = _Slide();

  /// Later pages lie over earlier ones: turning forward slides the next
  /// page over this one, turning back slides this page off the one before.
  static const RitoLayeredPageTurnEffect cover = _Cover();

  /// The pages cross-fade in place.
  static const RitoLayeredPageTurnEffect fade = _Fade();

  /// No animation: a turn lands at once.
  static const RitoLayeredPageTurnEffect none = _None();
}

final class _Slide extends RitoLayeredPageTurnEffect {
  const _Slide();

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) {
    final RitoPageTurnFrame(:offset, :width, :incoming) = frame;
    return [
      // A spring settling back past the origin shows the far neighbour
      // instead of a gap.
      if (incoming == RitoPageSlot.next && offset > 0)
        RitoPageTurnLayer(RitoPageSlot.previous, offset - width),
      if (incoming == RitoPageSlot.previous && offset < 0)
        RitoPageTurnLayer(RitoPageSlot.next, offset + width),
      RitoPageTurnLayer(RitoPageSlot.current, offset),
      if (incoming == RitoPageSlot.next)
        RitoPageTurnLayer(RitoPageSlot.next, offset + width),
      if (incoming == RitoPageSlot.previous)
        RitoPageTurnLayer(RitoPageSlot.previous, offset - width),
    ];
  }
}

final class _Cover extends RitoLayeredPageTurnEffect {
  const _Cover();

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) {
    final RitoPageTurnFrame(:offset, :width, :incoming) = frame;
    return switch (incoming) {
      RitoPageSlot.next => [
        const RitoPageTurnLayer(RitoPageSlot.current, 0),
        RitoPageTurnLayer(
          RitoPageSlot.next,
          math.max(0, width + offset),
          shadow: RitoPageEdge.left,
        ),
      ],
      RitoPageSlot.previous => [
        const RitoPageTurnLayer(RitoPageSlot.previous, 0),
        RitoPageTurnLayer(
          RitoPageSlot.current,
          math.max(0, offset),
          shadow: RitoPageEdge.left,
        ),
      ],
      _ => [RitoPageTurnLayer(RitoPageSlot.current, offset)],
    };
  }
}

final class _Fade extends RitoLayeredPageTurnEffect {
  const _Fade();

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) {
    final incoming = frame.incoming;
    if (incoming == null) {
      return [RitoPageTurnLayer(RitoPageSlot.current, frame.offset)];
    }
    final progress = frame.width > 0
        ? math.min(1.0, frame.offset.abs() / frame.width)
        : 1.0;
    return [
      const RitoPageTurnLayer(RitoPageSlot.current, 0),
      RitoPageTurnLayer(incoming, 0, opacity: progress),
    ];
  }
}

final class _None extends RitoLayeredPageTurnEffect {
  const _None();

  @override
  bool get instant => true;

  @override
  List<RitoPageTurnLayer> layers(RitoPageTurnFrame frame) => const [
    RitoPageTurnLayer(RitoPageSlot.current, 0),
  ];
}
