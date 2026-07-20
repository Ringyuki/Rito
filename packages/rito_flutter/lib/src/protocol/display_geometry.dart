final class RitoDisplayPoint {
  const RitoDisplayPoint({required this.x, required this.y});

  final double x;
  final double y;
}

final class RitoDisplaySize {
  const RitoDisplaySize({required this.width, required this.height});

  final double width;
  final double height;
}

final class RitoDisplayRect {
  const RitoDisplayRect({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  final double x;
  final double y;
  final double width;
  final double height;
}

final class RitoCornerRadius {
  const RitoCornerRadius({required this.rx, required this.ry});

  final double rx;
  final double ry;
}

sealed class RitoLength {
  const RitoLength(this.value);

  final double value;
}

final class RitoPxLength extends RitoLength {
  const RitoPxLength(super.value);
}

final class RitoPercentLength extends RitoLength {
  const RitoPercentLength(super.value);
}

sealed class RitoTransformOperation {
  const RitoTransformOperation();
}

final class RitoRotateTransform extends RitoTransformOperation {
  const RitoRotateTransform(this.radians);

  final double radians;
}

final class RitoScaleTransform extends RitoTransformOperation {
  const RitoScaleTransform({required this.sx, required this.sy});

  final double sx;
  final double sy;
}

final class RitoTranslateTransform extends RitoTransformOperation {
  const RitoTranslateTransform({required this.x, required this.y});

  final RitoLength x;
  final RitoLength y;
}
