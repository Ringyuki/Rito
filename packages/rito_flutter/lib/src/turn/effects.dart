import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import 'motion.dart';

/// The pages a turn can show: the one on screen and its neighbours.
enum RitoPageSlot { previous, current, next }

/// What is moving a page turn.
enum RitoPageTurnPhase {
  /// A finger holds it.
  held,

  /// It is on its way to the neighbour.
  landing,

  /// It is on its way back to the page it left.
  returning,
}

/// The finger that moved a turn: where it took hold of the page and where
/// it is — or, once it lifted, where it let go — in the view's logical px;
/// and where it was when it had carried the turn farthest the way the turn
/// goes ([farthest]), which is [position] when left out. A finger short of
/// its farthest has come back.
final class RitoPageTurnTouch {
  const RitoPageTurnTouch({
    required this.origin,
    required this.position,
    Offset? farthest,
  }) : farthest = farthest ?? position;

  final Offset origin;
  final Offset position;
  final Offset farthest;
}

/// One frame of a page turn as an effect sees it: how far the turn has
/// travelled ([offset], logical px, negative while turning forward), the
/// page width, which neighbour is coming in (null while pulling against the
/// first or last page), and what is moving it.
final class RitoPageTurnFrame {
  const RitoPageTurnFrame({
    required this.offset,
    required this.width,
    required this.incoming,
    required this.phase,
    this.velocity = 0,
    this.touch,
  });

  final double offset;
  final double width;
  final RitoPageSlot? incoming;
  final RitoPageTurnPhase phase;

  /// How fast [offset] is changing, logical px/s; 0 while a finger holds
  /// the turn.
  final double velocity;

  /// The finger that moved the turn; null for a turn no finger has held
  /// (a tap, a key, a jump played as a turn).
  final RitoPageTurnTouch? touch;

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

  /// Which spread of the book the page in [slot] is: what tells it from
  /// every other page from one turn to the next, and puts pages in reading
  /// order. The next page's is one more than the current page's and the
  /// previous page's one less; a page keeps it while turns move it from
  /// slot to slot, and when background pagination renumbers it. A page
  /// reached by a jump or a relayout gets one no page before it had (a jump
  /// played as a turn, past them on the side it comes in from). It is not
  /// a page number. Null while [slot] has no page.
  int? spread(RitoPageSlot slot);

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

/// How a page turn looks. How it moves — the drag, the decision to turn,
/// the way to rest, the pull at the ends of the book — is the controller's
/// `RitoPageTurnPhysics`; an effect paints what a frame shows.
///
/// Paint the frame directly for looks that bend or cut the pages (a curl),
/// or extend [RitoLayeredPageTurnEffect] to lay whole pages over each
/// other.
abstract class RitoPageTurnEffect {
  const RitoPageTurnEffect();

  /// A turn lands at once instead of animating (a drag still decides
  /// whether it turns).
  bool get instant => false;

  /// Notifies when the turn must be painted again though it has not
  /// moved: an effect on a clock of its own (a sheet that lags the finger,
  /// a ripple as it lands). Null for an effect that only follows the
  /// frame.
  Listenable? get repaint => null;

  /// How turns move with this effect: the physics it is made for, which
  /// the controller takes over its own. Null for an effect that moves as
  /// the controller's physics say.
  RitoPageTurnPhysics? get physics => null;

  /// Called between turns once the pages beside the one shown are painted:
  /// the place for work on those pages that a turn would otherwise do in
  /// its first frames, such as copying them where the effect draws from.
  void warm(RitoPageTurnPages pages) {}

  void paint(RitoPageTurnScene scene, RitoPageTurnFrame frame);
}

/// The edge of a sheet lying over the page beneath it, which casts a soft
/// shadow on that page. The shadow reaches 24 logical px and fades as its
/// sheet leaves the frame.
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
      if (shadow != null) _paintEdgeShadow(scene, layer.x, shadow);
      scene.drawPage(layer.slot, layer.x, opacity: layer.opacity);
    }
  }
}

/// How far a sheet's shadow reaches over the page beneath it, logical px.
const double _shadowReach = 24;

/// How dark the shadow is at the sheet's edge.
const double _shadowAlpha = 0.18;

/// The soft shadow the sheet at [x] casts on the page beneath it, from one
/// edge. A sheet leaving the frame takes its shadow with it: with less of
/// the sheet in the frame than the shadow reaches, the shadow is as strong
/// as that share, and gone when the sheet is. At full strength there it
/// stood beside a sheet no longer shown and went out in one frame when
/// the turn ended.
void _paintEdgeShadow(RitoPageTurnScene scene, double x, RitoPageEdge side) {
  final width = scene.size.width;
  final inFrame = math.min(x + width, width) - math.max(x, 0.0);
  final strength = math.min(1.0, inFrame / _shadowReach);
  if (strength <= 0) return;
  final edge = side == RitoPageEdge.left ? x : x + width;
  final to = side == RitoPageEdge.left
      ? edge - _shadowReach
      : edge + _shadowReach;
  final paint = Paint()
    ..shader = ui.Gradient.linear(Offset(edge, 0), Offset(to, 0), [
      Color.fromRGBO(0, 0, 0, _shadowAlpha * strength),
      const Color.fromRGBO(0, 0, 0, 0),
    ]);
  scene.canvas.drawRect(
    Rect.fromLTRB(math.min(edge, to), 0, math.max(edge, to), scene.size.height),
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
      // A custom spring bouncing back past the origin shows the far neighbour
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
