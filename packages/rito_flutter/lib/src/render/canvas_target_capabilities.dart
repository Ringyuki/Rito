part of 'canvas_target.dart';

extension _CanvasPaintCapabilities on RitoCanvasPaintTarget {
  void _validateHorizontalRulePaint(RitoPaintHorizontalRule command) {
    _validateBorderStyle(
      command.paint.style,
      width: _rect(command.rect).height,
      context: 'horizontal rule',
    );
  }

  _PreparedBlockPaint _prepareBlockPaint(RitoPaintBlock command, ui.Rect rect) {
    _validateBoxShadows(command.paint.boxShadows);
    _validateBlockBorderStyles(command.paint.border, command.borderBox);
    final background = command.paint.background;
    final href = background?.image;
    if (background == null || href == null || rect.isEmpty) {
      return const _PreparedBlockPaint();
    }
    final image = _resolveImage(href);
    if (image == null) {
      return const _PreparedBlockPaint();
    }
    final source = ui.Rect.fromLTWH(
      0,
      0,
      image.width.toDouble(),
      image.height.toDouble(),
    );
    if (source.isEmpty) {
      return const _PreparedBlockPaint();
    }
    final target = _backgroundTarget(source, rect, background);
    // The browser pen tiles every repeat mode except no-repeat on both
    // axes; mirror that collapse so the grids agree.
    final repeat = background.repeat ?? RitoBackgroundRepeat.repeat;
    final plan = RitoBackgroundTilePlan.create(
      boxLeft: rect.left,
      boxTop: rect.top,
      boxWidth: rect.width,
      boxHeight: rect.height,
      targetLeft: target.left,
      targetTop: target.top,
      targetWidth: target.width,
      targetHeight: target.height,
      repeat: repeat == RitoBackgroundRepeat.noRepeat
          ? RitoBackgroundRepeat.noRepeat
          : RitoBackgroundRepeat.repeat,
    );
    return _PreparedBlockPaint(image: image, tilePlan: plan);
  }

  void _validateBoxShadows(List<RitoBoxShadow> shadows) {
    for (final shadow in shadows) {
      if (shadow.blur < 0) {
        throw const RitoWireException(
          'RITODL1 box-shadow blur radius must not be negative.',
        );
      }
      if (shadow.inset) {
        throw UnsupportedError(
          'RITODL1 inset box-shadow is not supported by the Flutter Canvas '
          'adapter.',
        );
      }
    }
  }

  void _validateBlockBorderStyles(RitoBlockBorder? border, RitoBorderBox? box) {
    if (border == null || box == null) {
      return;
    }
    _validateBorderEdge(border.top, box.topWidth, 'top block border');
    _validateBorderEdge(border.right, box.rightWidth, 'right block border');
    _validateBorderEdge(border.bottom, box.bottomWidth, 'bottom block border');
    _validateBorderEdge(border.left, box.leftWidth, 'left block border');
  }

  void _validateBorderEdge(
    RitoBorderEdgePaint? edge,
    double width,
    String context,
  ) {
    if (edge == null) {
      return;
    }
    _validateBorderStyle(edge.style, width: width, context: context);
  }

  void _validateBorderStyle(
    RitoBorderStyle style, {
    required double width,
    required String context,
  }) {
    if (width <= 0) {
      return;
    }
    if (style == RitoBorderStyle.groove ||
        style == RitoBorderStyle.ridge ||
        style == RitoBorderStyle.inset ||
        style == RitoBorderStyle.outset) {
      throw UnsupportedError(
        'RITODL1 ${style.name} $context is not supported by the Flutter '
        'Canvas adapter.',
      );
    }
  }
}

final class _PreparedBlockPaint {
  const _PreparedBlockPaint({this.image, this.tilePlan});

  final ui.Image? image;
  final RitoBackgroundTilePlan? tilePlan;
}
