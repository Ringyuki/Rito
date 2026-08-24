final class RitoColorSpace {
  const RitoColorSpace._(this.name);

  final String name;

  static const RitoColorSpace srgb = RitoColorSpace._('srgb');
  static const RitoColorSpace hsl = RitoColorSpace._('hsl');
  static const RitoColorSpace hwb = RitoColorSpace._('hwb');
  static const RitoColorSpace lab = RitoColorSpace._('lab');
  static const RitoColorSpace lch = RitoColorSpace._('lch');
  static const RitoColorSpace oklab = RitoColorSpace._('oklab');
  static const RitoColorSpace oklch = RitoColorSpace._('oklch');
  static const RitoColorSpace srgbLinear = RitoColorSpace._('srgb-linear');
  static const RitoColorSpace displayP3 = RitoColorSpace._('display-p3');
  static const RitoColorSpace displayP3Linear = RitoColorSpace._(
    'display-p3-linear',
  );
  static const RitoColorSpace a98Rgb = RitoColorSpace._('a98-rgb');
  static const RitoColorSpace prophotoRgb = RitoColorSpace._('prophoto-rgb');
  static const RitoColorSpace rec2020 = RitoColorSpace._('rec2020');
  static const RitoColorSpace xyzD50 = RitoColorSpace._('xyz-d50');
  static const RitoColorSpace xyzD65 = RitoColorSpace._('xyz-d65');
}

final class RitoColorNoneFlags {
  const RitoColorNoneFlags({
    required this.component0,
    required this.component1,
    required this.component2,
    required this.alpha,
  });

  final bool component0;
  final bool component1;
  final bool component2;
  final bool alpha;
}

final class RitoColor {
  const RitoColor({
    required this.space,
    required this.component0,
    required this.component1,
    required this.component2,
    required this.alpha,
    required this.none,
  });

  final RitoColorSpace space;
  final double component0;
  final double component1;
  final double component2;
  final double alpha;
  final RitoColorNoneFlags none;
}
