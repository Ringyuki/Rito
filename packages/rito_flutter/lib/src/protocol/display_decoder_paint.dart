part of 'display_decoder.dart';

const List<RitoColorSpace> _colorSpaces = <RitoColorSpace>[
  RitoColorSpace.srgb,
  RitoColorSpace.hsl,
  RitoColorSpace.hwb,
  RitoColorSpace.lab,
  RitoColorSpace.lch,
  RitoColorSpace.oklab,
  RitoColorSpace.oklch,
  RitoColorSpace.srgbLinear,
  RitoColorSpace.displayP3,
  RitoColorSpace.displayP3Linear,
  RitoColorSpace.a98Rgb,
  RitoColorSpace.prophotoRgb,
  RitoColorSpace.rec2020,
  RitoColorSpace.xyzD50,
  RitoColorSpace.xyzD65,
];

extension _RitoDisplayPaintReader on RitoBinaryReader {
  RitoRunPaint readRunPaint() {
    final font = RitoFontPaint(
      family: string('font family'),
      sizePx: float64('font size'),
      weight: float64('font weight'),
      style: _wireEnum(this, 'font style', const <RitoFontStyle>[
        RitoFontStyle.normal,
        RitoFontStyle.italic,
      ]),
    );
    final color = readColor();
    final shadowCount = count('text shadow count');
    final shadows = <RitoTextShadow>[];
    for (var index = 0; index < shadowCount; index += 1) {
      shadows.add(readTextShadow());
    }
    return RitoRunPaint(font: font, color: color, textShadows: shadows);
  }

  RitoTextShadow readTextShadow() {
    return RitoTextShadow(
      offsetX: float64('text shadow offset x'),
      offsetY: float64('text shadow offset y'),
      blur: float64('text shadow blur'),
      color: readColor(),
    );
  }

  RitoColor readColor() {
    final space = _wireEnum(this, 'color space', _colorSpaces);
    final component0 = float32('color component 0');
    final component1 = float32('color component 1');
    final component2 = float32('color component 2');
    final alpha = float32('color alpha');
    final flags = uint8('color none flags');
    if (flags & 0xf0 != 0) {
      fail('color none flags contain unknown bits: $flags');
    }
    return RitoColor(
      space: space,
      component0: component0,
      component1: component1,
      component2: component2,
      alpha: alpha,
      none: RitoColorNoneFlags(
        component0: flags & 0x01 != 0,
        component1: flags & 0x02 != 0,
        component2: flags & 0x04 != 0,
        alpha: flags & 0x08 != 0,
      ),
    );
  }
}
