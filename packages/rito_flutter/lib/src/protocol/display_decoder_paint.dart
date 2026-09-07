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

const List<RitoBorderStyle> _borderStyles = <RitoBorderStyle>[
  RitoBorderStyle.none,
  RitoBorderStyle.hidden,
  RitoBorderStyle.dotted,
  RitoBorderStyle.dashed,
  RitoBorderStyle.solid,
  RitoBorderStyle.double,
  RitoBorderStyle.groove,
  RitoBorderStyle.ridge,
  RitoBorderStyle.inset,
  RitoBorderStyle.outset,
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
    final wordSpacing = option('word spacing', () => float64('word spacing'));
    final letterSpacing = option(
      'letter spacing',
      () => float64('letter spacing'),
    );
    final backgroundColor = option('text background color', readColor);
    final backgroundRadius = option(
      'text background radius',
      () => float64('text background radius'),
    );
    final shadowCount = count('text shadow count');
    final shadows = <RitoTextShadow>[];
    for (var index = 0; index < shadowCount; index += 1) {
      shadows.add(readTextShadow());
    }
    final decoration = option('text decoration', readRunDecoration);
    final padding = option('text padding', readSpacing);
    final border = option('text border', readRunBorder);
    final boxOffsets = option('inline box offsets', () {
      return (float64('inline box top'), float64('inline box bottom'));
    });
    return RitoRunPaint(
      font: font,
      color: color,
      wordSpacingPx: wordSpacing,
      letterSpacingPx: letterSpacing,
      backgroundColor: backgroundColor,
      backgroundRadius: backgroundRadius,
      textShadows: shadows,
      decoration: decoration,
      padding: padding,
      border: border,
      boxTopPx: boxOffsets?.$1,
      boxBottomPx: boxOffsets?.$2,
      boxStart: boolean('inline box start'),
      boxEnd: boolean('inline box end'),
    );
  }

  RitoTextShadow readTextShadow() {
    return RitoTextShadow(
      offsetX: float64('text shadow offset x'),
      offsetY: float64('text shadow offset y'),
      blur: float64('text shadow blur'),
      color: readColor(),
    );
  }

  RitoRunDecoration readRunDecoration() {
    return RitoRunDecoration(
      kind: _wireEnum(
        this,
        'text decoration kind',
        const <RitoRunDecorationKind>[
          RitoRunDecorationKind.underline,
          RitoRunDecorationKind.lineThrough,
        ],
      ),
      y: float64('text decoration y'),
      thickness: float64('text decoration thickness'),
      color: readColor(),
    );
  }

  RitoSpacing readSpacing() {
    return RitoSpacing(
      top: float64('text padding top'),
      right: float64('text padding right'),
      bottom: float64('text padding bottom'),
      left: float64('text padding left'),
    );
  }

  RitoRunBorder readRunBorder() {
    return RitoRunBorder(
      top: option('text top border', readRunBorderEdge),
      bottom: option('text bottom border', readRunBorderEdge),
      start: option('text start border', readRunBorderEdge),
      end: option('text end border', readRunBorderEdge),
    );
  }

  RitoRunBorderEdge readRunBorderEdge() {
    return RitoRunBorderEdge(
      widthPx: float64('text border width'),
      paint: readBorderEdgePaint(),
    );
  }

  RitoBorderEdgePaint readBorderEdgePaint() {
    return RitoBorderEdgePaint(
      color: readColor(),
      style: _wireEnum(this, 'border style', _borderStyles),
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
