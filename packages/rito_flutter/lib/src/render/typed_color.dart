import 'dart:math' as math;
import 'dart:ui' as ui;

import '../protocol/display_color.dart';

/// Converts typed CSS Color 4 components to a Flutter paint color.
///
/// Display P3 stays in Display P3. Other spaces are converted through their
/// specified white point to sRGB, with final channel clipping at the Canvas
/// boundary. No CSS source text reaches this layer.
ui.Color ritoUiColor(RitoColor color) {
  final c0 = color.none.component0 ? 0.0 : color.component0;
  final c1 = color.none.component1 ? 0.0 : color.component1;
  final c2 = color.none.component2 ? 0.0 : color.component2;
  final alpha = _unit(color.none.alpha ? 0.0 : color.alpha);

  if (color.space == RitoColorSpace.displayP3) {
    return ui.Color.from(
      alpha: alpha,
      red: _unit(c0),
      green: _unit(c1),
      blue: _unit(c2),
      colorSpace: ui.ColorSpace.displayP3,
    );
  }
  if (color.space == RitoColorSpace.displayP3Linear) {
    return ui.Color.from(
      alpha: alpha,
      red: _unit(_linearToSrgb(c0)),
      green: _unit(_linearToSrgb(c1)),
      blue: _unit(_linearToSrgb(c2)),
      colorSpace: ui.ColorSpace.displayP3,
    );
  }

  final (red, green, blue) = _toSrgb(color.space, c0, c1, c2);
  return ui.Color.from(
    alpha: alpha,
    red: _unit(red),
    green: _unit(green),
    blue: _unit(blue),
  );
}

(double, double, double) _toSrgb(
  RitoColorSpace space,
  double c0,
  double c1,
  double c2,
) {
  if (space == RitoColorSpace.srgb) {
    return (c0, c1, c2);
  }
  if (space == RitoColorSpace.hsl) {
    return _hsl(c0, c1 / 100, c2 / 100);
  }
  if (space == RitoColorSpace.hwb) {
    return _hwb(c0, c1 / 100, c2 / 100);
  }
  if (space == RitoColorSpace.oklab) {
    return _linearRgbToSrgb(_oklabToLinearSrgb(c0, c1, c2));
  }
  if (space == RitoColorSpace.oklch) {
    final radians = c2 * math.pi / 180;
    return _linearRgbToSrgb(
      _oklabToLinearSrgb(c0, c1 * math.cos(radians), c1 * math.sin(radians)),
    );
  }

  late final (double, double, double) xyzD65;
  if (space == RitoColorSpace.lab || space == RitoColorSpace.lch) {
    final (lightness, a, b) = space == RitoColorSpace.lab
        ? (c0, c1, c2)
        : (
            c0,
            c1 * math.cos(c2 * math.pi / 180),
            c1 * math.sin(c2 * math.pi / 180),
          );
    xyzD65 = _d50ToD65(_labToXyzD50(lightness, a, b));
  } else if (space == RitoColorSpace.xyzD50) {
    xyzD65 = _d50ToD65((c0, c1, c2));
  } else if (space == RitoColorSpace.xyzD65) {
    xyzD65 = (c0, c1, c2);
  } else if (space == RitoColorSpace.srgbLinear) {
    return _linearRgbToSrgb((c0, c1, c2));
  } else if (space == RitoColorSpace.a98Rgb) {
    xyzD65 = _matrix(
      (
        _signedPow(c0, 563 / 256),
        _signedPow(c1, 563 / 256),
        _signedPow(c2, 563 / 256),
      ),
      const <double>[
        0.5767309,
        0.1855540,
        0.1881852,
        0.2973769,
        0.6273491,
        0.0752741,
        0.0270343,
        0.0706872,
        0.9911085,
      ],
    );
  } else if (space == RitoColorSpace.prophotoRgb) {
    final linear = (
      _prophotoToLinear(c0),
      _prophotoToLinear(c1),
      _prophotoToLinear(c2),
    );
    xyzD65 = _d50ToD65(
      _matrix(linear, const <double>[
        0.7977666449,
        0.1351812974,
        0.0313477341,
        0.2880748288,
        0.7118352342,
        0.0000899369,
        0,
        0,
        0.8251046025,
      ]),
    );
  } else if (space == RitoColorSpace.rec2020) {
    xyzD65 = _matrix(
      (_rec2020ToLinear(c0), _rec2020ToLinear(c1), _rec2020ToLinear(c2)),
      const <double>[
        0.6369580483,
        0.1446169036,
        0.1688809752,
        0.2627002120,
        0.6779980715,
        0.0593017165,
        0,
        0.0280726930,
        1.0609850577,
      ],
    );
  } else {
    throw StateError('Unsupported typed color space: ${space.name}');
  }
  return _linearRgbToSrgb(
    _matrix(xyzD65, const <double>[
      3.2409699419,
      -1.5373831776,
      -0.4986107603,
      -0.9692436363,
      1.8759675015,
      0.0415550574,
      0.0556300797,
      -0.2039769589,
      1.0569715142,
    ]),
  );
}

(double, double, double) _hsl(
  double hueDegrees,
  double saturation,
  double lightness,
) {
  final hue = ((hueDegrees % 360) + 360) % 360 / 360;
  final saturationClamped = _unit(saturation);
  final lightnessClamped = _unit(lightness);
  if (saturationClamped == 0) {
    return (lightnessClamped, lightnessClamped, lightnessClamped);
  }
  final q = lightnessClamped < .5
      ? lightnessClamped * (1 + saturationClamped)
      : lightnessClamped +
            saturationClamped -
            lightnessClamped * saturationClamped;
  final p = 2 * lightnessClamped - q;
  return (
    _hueChannel(p, q, hue + 1 / 3),
    _hueChannel(p, q, hue),
    _hueChannel(p, q, hue - 1 / 3),
  );
}

double _hueChannel(double p, double q, double hue) {
  var wrapped = hue;
  if (wrapped < 0) wrapped += 1;
  if (wrapped > 1) wrapped -= 1;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < .5) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

(double, double, double) _hwb(double hue, double whiteness, double blackness) {
  final white = _unit(whiteness);
  final black = _unit(blackness);
  if (white + black >= 1) {
    final gray = white / (white + black);
    return (gray, gray, gray);
  }
  final (red, green, blue) = _hsl(hue, 1, .5);
  final scale = 1 - white - black;
  return (red * scale + white, green * scale + white, blue * scale + white);
}

(double, double, double) _labToXyzD50(double lightness, double a, double b) {
  final f1 = (lightness + 16) / 116;
  final f0 = f1 + a / 500;
  final f2 = f1 - b / 200;
  return (
    _labInverse(f0) * 0.96422,
    _labInverse(f1),
    _labInverse(f2) * 0.82521,
  );
}

double _labInverse(double value) {
  const delta = 6 / 29;
  return value > delta
      ? value * value * value
      : 3 * delta * delta * (value - 4 / 29);
}

(double, double, double) _oklabToLinearSrgb(
  double lightness,
  double a,
  double b,
) {
  final l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  final m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  final s = lightness - 0.0894841775 * a - 1.2914855480 * b;
  final l3 = l * l * l;
  final m3 = m * m * m;
  final s3 = s * s * s;
  return (
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  );
}

(double, double, double) _d50ToD65((double, double, double) xyz) {
  return _matrix(xyz, const <double>[
    0.9554734215,
    -0.0230984549,
    0.0632592432,
    -0.0283697093,
    1.0099953981,
    0.0210414412,
    0.0123140149,
    -0.0205076493,
    1.3303659262,
  ]);
}

(double, double, double) _matrix(
  (double, double, double) value,
  List<double> matrix,
) {
  final (x, y, z) = value;
  return (
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  );
}

(double, double, double) _linearRgbToSrgb((double, double, double) value) {
  final (red, green, blue) = value;
  return (_linearToSrgb(red), _linearToSrgb(green), _linearToSrgb(blue));
}

double _linearToSrgb(double value) {
  final magnitude = value.abs();
  final encoded =
      (magnitude <= 0.0031308
              ? 12.92 * magnitude
              : 1.055 * math.pow(magnitude, 1 / 2.4) - 0.055)
          .toDouble();
  return value < 0 ? -encoded : encoded;
}

double _prophotoToLinear(double value) {
  final magnitude = value.abs();
  final linear = magnitude <= 16 / 512
      ? magnitude / 16
      : math.pow(magnitude, 1.8).toDouble();
  return value < 0 ? -linear : linear;
}

double _rec2020ToLinear(double value) {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  final magnitude = value.abs();
  final linear = magnitude < beta * 4.5
      ? magnitude / 4.5
      : math.pow((magnitude + alpha - 1) / alpha, 1 / 0.45).toDouble();
  return value < 0 ? -linear : linear;
}

double _signedPow(double value, double exponent) {
  final result = math.pow(value.abs(), exponent).toDouble();
  return value < 0 ? -result : result;
}

double _unit(double value) => value.clamp(0.0, 1.0).toDouble();
