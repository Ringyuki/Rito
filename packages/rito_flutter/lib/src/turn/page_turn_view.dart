import 'package:flutter/widgets.dart';

import 'effects.dart';
import 'page_turn_drag.dart';
import 'page_turn_controller.dart';

/// Shows a page and the turns away from it.
///
/// While no turn is on screen it shows [child] — the live, interactive
/// page (typically a [RitoPageSurface] of the reader's page with the host's
/// overlays). During a turn it paints the controller's effect from page
/// textures instead, keeping [child] mounted underneath. Size it to the
/// page: textures are drawn to fill it.
///
/// With [dragToTurn] it turns pages under a drag itself, taken as the web
/// reader takes one ([RitoPageTurnDragRecognizer]); a host that arbitrates
/// gestures (text selection, taps on links) or turns pages with another
/// gesture leaves it off and feeds the controller's drag methods from its
/// own recognizers, in this view's coordinates.
final class RitoPageTurnView extends StatefulWidget {
  const RitoPageTurnView({
    required this.controller,
    required this.child,
    this.background = const Color(0xFFFFFFFF),
    this.dragToTurn = true,
    super.key,
  });

  final RitoPageTurnController controller;
  final Widget child;

  /// The paper colour behind pages and wherever an effect shows no page.
  final Color background;
  final bool dragToTurn;

  @override
  State<RitoPageTurnView> createState() => _RitoPageTurnViewState();
}

final class _RitoPageTurnViewState extends State<RitoPageTurnView> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncEnvironment();
  }

  @override
  void didUpdateWidget(RitoPageTurnView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncEnvironment();
  }

  /// Keeps the controller in step with the platform; applied after the
  /// frame because it can redraw textures and notify listeners.
  void _syncEnvironment() {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final pixelRatio = MediaQuery.devicePixelRatioOf(context);
    final background = widget.background;
    final controller = widget.controller;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || controller != widget.controller) return;
      controller.reduceMotion = reduceMotion;
      controller.textures.configure(
        pixelRatio: pixelRatio,
        background: background,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    Widget view = LayoutBuilder(
      builder: (context, constraints) {
        controller.width = constraints.maxWidth;
        return ListenableBuilder(
          listenable: controller,
          builder: (context, child) {
            // Painted while anything moves: a turn, or what is left of one.
            final turning = controller.isMoving;
            return Stack(
              fit: StackFit.expand,
              children: [
                Visibility(
                  visible: !turning,
                  maintainState: true,
                  maintainAnimation: true,
                  maintainSize: true,
                  child: child!,
                ),
                if (turning)
                  CustomPaint(
                    painter: _TurnPainter(controller, widget.background),
                  ),
              ],
            );
          },
          child: widget.child,
        );
      },
    );
    if (widget.dragToTurn) {
      view = RawGestureDetector(
        behavior: HitTestBehavior.opaque,
        gestures: {
          RitoPageTurnDragRecognizer:
              GestureRecognizerFactoryWithHandlers<RitoPageTurnDragRecognizer>(
                () => RitoPageTurnDragRecognizer(debugOwner: this),
                (recognizer) {
                  recognizer
                    ..onStart = (down, at) {
                      controller.dragStart(down, at: at);
                    }
                    ..onUpdate = (position, at) {
                      controller.dragUpdate(position, at: at);
                    }
                    ..onEnd = (position, at) {
                      controller.dragEnd(position: position, at: at);
                    }
                    ..onCancel = controller.dragCancel;
                },
              ),
        },
        child: view,
      );
    }
    return view;
  }
}

final class _TurnPainter extends CustomPainter {
  _TurnPainter(RitoPageTurnController controller, Color background)
    : this._(controller, background, controller.effectiveEffect);

  _TurnPainter._(this.controller, this.background, this.effect)
    : super(repaint: Listenable.merge([controller, effect.repaint]));

  final RitoPageTurnController controller;
  final Color background;
  final RitoPageTurnEffect effect;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = background);
    effect.paint(
      RitoPageTurnScene(
        canvas: canvas,
        size: size,
        pages: controller.textures,
        background: background,
      ),
      controller.frame,
    );
  }

  @override
  bool shouldRepaint(_TurnPainter oldDelegate) =>
      oldDelegate.controller != controller ||
      oldDelegate.background != background ||
      oldDelegate.effect != effect;
}
