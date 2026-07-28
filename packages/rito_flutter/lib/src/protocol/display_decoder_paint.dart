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
  RitoPagePaint readPagePaint() {
    return RitoPagePaint(
      backgroundColor: option('page background color', readColor),
    );
  }

  RitoBlockPaint readBlockPaint() {
    final background = option('block background', readBackgroundPaint);
    final border = option('block border', readBlockBorder);
    final radius = option('block radius', readBlockRadius);
    final shadowCount = count('box shadow count');
    final shadows = <RitoBoxShadow>[];
    for (var index = 0; index < shadowCount; index += 1) {
      shadows.add(readBoxShadow());
    }
    return RitoBlockPaint(
      background: background,
      border: border,
      radius: radius,
      boxShadows: shadows,
    );
  }

  RitoBackgroundPaint readBackgroundPaint() {
    return RitoBackgroundPaint(
      color: option('background color', readColor),
      image: option('background image', () => string('background image')),
      size: option(
        'background size',
        () => _wireEnum(this, 'background size', const <RitoBackgroundSize>[
          RitoBackgroundSize.auto,
          RitoBackgroundSize.cover,
          RitoBackgroundSize.contain,
        ]),
      ),
      repeat: option(
        'background repeat',
        () => _wireEnum(this, 'background repeat', const <RitoBackgroundRepeat>[
          RitoBackgroundRepeat.repeat,
          RitoBackgroundRepeat.noRepeat,
          RitoBackgroundRepeat.repeatX,
          RitoBackgroundRepeat.repeatY,
          RitoBackgroundRepeat.space,
          RitoBackgroundRepeat.round,
        ]),
      ),
      position: option(
        'background position',
        () => RitoBackgroundPosition(
          x: readLength('background position x'),
          y: readLength('background position y'),
        ),
      ),
    );
  }

  RitoBlockBorder readBlockBorder() {
    return RitoBlockBorder(
      top: option('top block border', readBorderEdgePaint),
      right: option('right block border', readBorderEdgePaint),
      bottom: option('bottom block border', readBorderEdgePaint),
      left: option('left block border', readBorderEdgePaint),
    );
  }

  RitoBlockRadius readBlockRadius() {
    final tag = uint8('block radius tag');
    return switch (tag) {
      1 => RitoBlockPxRadius(float64('block radius')),
      2 => RitoBlockPercentRadius(float64('block radius')),
      3 => RitoBlockCornersRadius(<double>[
        float64('block radius top-left'),
        float64('block radius top-right'),
        float64('block radius bottom-right'),
        float64('block radius bottom-left'),
      ]),
      _ => fail('unknown block radius tag: $tag'),
    };
  }

  RitoBoxShadow readBoxShadow() {
    return RitoBoxShadow(
      offsetX: float64('box shadow offset x'),
      offsetY: float64('box shadow offset y'),
      blur: float64('box shadow blur'),
      spread: float64('box shadow spread'),
      color: readColor(),
      inset: boolean('box shadow inset'),
    );
  }

  RitoBorderBox readBorderBox() {
    return RitoBorderBox(
      topWidth: float64('border box top width'),
      rightWidth: float64('border box right width'),
      bottomWidth: float64('border box bottom width'),
      leftWidth: float64('border box left width'),
    );
  }

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
    return RitoRunPaint(
      font: font,
      color: color,
      wordSpacingPx: wordSpacing,
      letterSpacingPx: letterSpacing,
      backgroundColor: backgroundColor,
      backgroundRadius: backgroundRadius,
      textShadows: shadows,
      decoration: option('text decoration', readRunDecoration),
      padding: option('text padding', readSpacing),
      border: option('text border', readRunBorder),
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

  RitoHorizontalRulePaint readHorizontalRulePaint() {
    return RitoHorizontalRulePaint(
      color: readColor(),
      style: _wireEnum(this, 'horizontal rule style', _borderStyles),
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
