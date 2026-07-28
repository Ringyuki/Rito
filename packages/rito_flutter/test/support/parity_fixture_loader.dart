// Loads tools/paint-parity JSON fixtures into RitoCommand lists and
// generates the synthetic images both pens share. Fixture JSON uses the
// browser painter's CoreFrameCommand shape (colors as CSS strings), so
// this loader is the single translation point — keep the synthetic
// pixel definitions byte-identical with harness/entry.ts.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:rito_flutter/rito_flutter_protocol.dart';

final class ParityFixture {
  ParityFixture({
    required this.name,
    required this.width,
    required this.height,
    this.background,
    required this.commands,
  });

  final String name;
  final int width;
  final int height;
  final RitoColor? background;
  final List<RitoCommand> commands;
}

ParityFixture parseParityFixture(Map<String, Object?> json) {
  final commands = <RitoCommand>[];
  for (final entry in json['commands']! as List<Object?>) {
    commands.add(_command(entry! as Map<String, Object?>));
  }
  return ParityFixture(
    name: json['name']! as String,
    width: (json['width']! as num).toInt(),
    height: (json['height']! as num).toInt(),
    background: json['background'] == null
        ? null
        : parseCssColor(json['background']! as String),
    commands: commands,
  );
}

RitoCommand _command(Map<String, Object?> json) {
  final kind = json['kind']! as String;
  switch (kind) {
    case 'pushState':
      return const RitoPushState();
    case 'popState':
      return const RitoPopState();
    case 'translate':
      return RitoTranslate(
        dx: _double(json['dx']),
        dy: _double(json['dy']),
      );
    case 'opacity':
      return RitoOpacity(_double(json['value']));
    case 'transform':
      return _transform(json);
    case 'clipRect':
      final radius = json['radius'] as Map<String, Object?>?;
      return RitoClipRect(
        rect: _rect(json['rect']!),
        radius: radius == null
            ? null
            : RitoCornerRadius(
                rx: _double(radius['rx']),
                ry: _double(radius['ry']),
              ),
      );
    case 'paintPage':
      final paint = json['paint']! as Map<String, Object?>;
      return RitoPaintPage(
        rect: _rect(json['rect']!),
        paint: RitoPagePaint(backgroundColor: _color(paint['backgroundColor'])),
      );
    case 'paintBlock':
      return RitoPaintBlock(
        rect: _rect(json['rect']!),
        paint: _blockPaint(json['paint']! as Map<String, Object?>),
        borderBox: _borderBox(json['borderBox']),
      );
    case 'paintText':
    case 'paintRuby':
      final rect = _rect(json['rect']!);
      final paint = _runPaint(json['paint']! as Map<String, Object?>);
      final lineHeight = json['lineHeightPx'] == null
          ? null
          : _double(json['lineHeightPx']);
      return kind == 'paintText'
          ? RitoPaintText(
              text: json['text']! as String,
              rect: rect,
              paint: paint,
              lineHeightPx: lineHeight,
            )
          : RitoPaintRuby(
              text: json['text']! as String,
              rect: rect,
              paint: paint,
              lineHeightPx: lineHeight,
            );
    case 'paintImage':
      return RitoPaintImage(
        src: json['src']! as String,
        rect: _rect(json['rect']!),
        sourceRect: json['sourceRect'] == null
            ? null
            : _rect(json['sourceRect']!),
      );
    case 'paintHorizontalRule':
      final paint = json['paint']! as Map<String, Object?>;
      return RitoPaintHorizontalRule(
        rect: _rect(json['rect']!),
        paint: RitoHorizontalRulePaint(
          color: parseCssColor(paint['color']! as String),
          style: _borderStyle(paint['style']! as String),
        ),
      );
    default:
      throw FormatException('unknown parity command kind: $kind');
  }
}

RitoTransform _transform(Map<String, Object?> json) {
  final origin = json['origin']! as Map<String, Object?>;
  final box = json['box']! as Map<String, Object?>;
  final transforms = <RitoTransformOperation>[];
  for (final entry in json['transforms']! as List<Object?>) {
    final t = entry! as Map<String, Object?>;
    switch (t['kind']! as String) {
      case 'rotate':
        transforms.add(RitoRotateTransform(_double(t['rad'])));
      case 'scale':
        transforms.add(
          RitoScaleTransform(sx: _double(t['sx']), sy: _double(t['sy'])),
        );
      case 'translate':
        transforms.add(
          RitoTranslateTransform(x: _length(t['x']!), y: _length(t['y']!)),
        );
      default:
        throw FormatException('unknown transform kind: ${t['kind']}');
    }
  }
  return RitoTransform(
    origin: RitoDisplayPoint(x: _double(origin['x']), y: _double(origin['y'])),
    boxSize: RitoDisplaySize(
      width: _double(box['width']),
      height: _double(box['height']),
    ),
    transforms: transforms,
  );
}

RitoBlockPaint _blockPaint(Map<String, Object?> json) {
  final backgroundJson = json['background'] as Map<String, Object?>?;
  final borderJson = json['border'] as Map<String, Object?>?;
  final shadows = <RitoBoxShadow>[];
  for (final entry in (json['boxShadow'] as List<Object?>?) ?? const []) {
    final s = entry! as Map<String, Object?>;
    shadows.add(
      RitoBoxShadow(
        offsetX: _double(s['offsetX']),
        offsetY: _double(s['offsetY']),
        blur: _double(s['blur']),
        spread: _double(s['spread']),
        color: parseCssColor(s['color']! as String),
        inset: (s['inset'] as bool?) ?? false,
      ),
    );
  }
  return RitoBlockPaint(
    background: backgroundJson == null
        ? null
        : RitoBackgroundPaint(
            color: _color(backgroundJson['color']),
            image: backgroundJson['image'] as String?,
            size: _backgroundSize(backgroundJson['size']),
            repeat: _backgroundRepeat(backgroundJson['repeat'] as String?),
            position: _backgroundPosition(backgroundJson['position']),
          ),
    border: borderJson == null
        ? null
        : RitoBlockBorder(
            top: _borderEdgePaint(borderJson['top']),
            right: _borderEdgePaint(borderJson['right']),
            bottom: _borderEdgePaint(borderJson['bottom']),
            left: _borderEdgePaint(borderJson['left']),
          ),
    radius: _blockRadius(json['radius']),
    boxShadows: shadows,
  );
}

RitoBlockRadius? _blockRadius(Object? json) {
  if (json == null) return null;
  final map = json as Map<String, Object?>;
  if (map['px'] != null) return RitoBlockPxRadius(_double(map['px']));
  if (map['pct'] != null) return RitoBlockPercentRadius(_double(map['pct']));
  if (map['corners'] != null) {
    // Wire tag 3 (per-corner radii) is not represented in the Flutter
    // protocol model yet; surfacing the gap in the diff is the point.
    throw UnsupportedError('corners radius not yet supported by rito_flutter');
  }
  throw FormatException('unknown radius shape: $map');
}

RitoBackgroundSize? _backgroundSize(Object? json) {
  if (json == null) return null;
  final name = json as String;
  return switch (name) {
    'auto' => RitoBackgroundSize.auto,
    'cover' => RitoBackgroundSize.cover,
    'contain' => RitoBackgroundSize.contain,
    _ => throw FormatException('unknown background size: $name'),
  };
}

RitoBackgroundRepeat? _backgroundRepeat(String? name) {
  if (name == null) return null;
  return switch (name) {
    'repeat' => RitoBackgroundRepeat.repeat,
    'no-repeat' => RitoBackgroundRepeat.noRepeat,
    'repeat-x' => RitoBackgroundRepeat.repeatX,
    'repeat-y' => RitoBackgroundRepeat.repeatY,
    'space' => RitoBackgroundRepeat.space,
    'round' => RitoBackgroundRepeat.round,
    _ => throw FormatException('unknown background repeat: $name'),
  };
}

RitoBackgroundPosition? _backgroundPosition(Object? json) {
  if (json == null) return null;
  final map = json as Map<String, Object?>;
  return RitoBackgroundPosition(x: _length(map['x']!), y: _length(map['y']!));
}

RitoBorderEdgePaint? _borderEdgePaint(Object? json) {
  if (json == null) return null;
  final map = json as Map<String, Object?>;
  return RitoBorderEdgePaint(
    color: parseCssColor(map['color']! as String),
    style: _borderStyle(map['style']! as String),
  );
}

RitoBorderBox? _borderBox(Object? json) {
  if (json == null) return null;
  final map = json as Map<String, Object?>;
  return RitoBorderBox(
    topWidth: _double(map['topWidth']),
    rightWidth: _double(map['rightWidth']),
    bottomWidth: _double(map['bottomWidth']),
    leftWidth: _double(map['leftWidth']),
  );
}

RitoRunPaint _runPaint(Map<String, Object?> json) {
  final font = json['font']! as Map<String, Object?>;
  final shadows = <RitoTextShadow>[];
  for (final entry in (json['textShadow'] as List<Object?>?) ?? const []) {
    final s = entry! as Map<String, Object?>;
    shadows.add(
      RitoTextShadow(
        offsetX: _double(s['offsetX']),
        offsetY: _double(s['offsetY']),
        blur: _double(s['blur']),
        color: parseCssColor(s['color']! as String),
      ),
    );
  }
  final decorationJson = json['decoration'] as Map<String, Object?>?;
  final paddingJson = json['padding'] as Map<String, Object?>?;
  final borderJson = json['border'] as Map<String, Object?>?;
  return RitoRunPaint(
    font: RitoFontPaint(
      family: font['family']! as String,
      sizePx: _double(font['sizePx']),
      weight: _double(font['weight']),
      style: (font['style'] as String?) == 'italic'
          ? RitoFontStyle.italic
          : RitoFontStyle.normal,
    ),
    color: parseCssColor(json['color']! as String),
    wordSpacingPx: json['wordSpacingPx'] == null
        ? null
        : _double(json['wordSpacingPx']),
    letterSpacingPx: json['letterSpacingPx'] == null
        ? null
        : _double(json['letterSpacingPx']),
    backgroundColor: _color(json['backgroundColor']),
    backgroundRadius: json['backgroundRadius'] == null
        ? null
        : _double(json['backgroundRadius']),
    textShadows: shadows,
    decoration: decorationJson == null
        ? null
        : RitoRunDecoration(
            kind: (decorationJson['kind'] as String?) == 'line-through'
                ? RitoRunDecorationKind.lineThrough
                : RitoRunDecorationKind.underline,
            y: _double(decorationJson['y']),
            thickness: _double(decorationJson['thickness']),
            color: parseCssColor(decorationJson['color']! as String),
          ),
    padding: paddingJson == null
        ? null
        : RitoSpacing(
            top: _double(paddingJson['top']),
            right: _double(paddingJson['right']),
            bottom: _double(paddingJson['bottom']),
            left: _double(paddingJson['left']),
          ),
    border: borderJson == null
        ? null
        : RitoRunBorder(
            top: _runBorderEdge(borderJson['top']),
            bottom: _runBorderEdge(borderJson['bottom']),
            start: _runBorderEdge(borderJson['start']),
            end: _runBorderEdge(borderJson['end']),
          ),
  );
}

RitoRunBorderEdge? _runBorderEdge(Object? json) {
  if (json == null) return null;
  final map = json as Map<String, Object?>;
  final paint = map['paint']! as Map<String, Object?>;
  return RitoRunBorderEdge(
    widthPx: _double(map['widthPx']),
    paint: RitoBorderEdgePaint(
      color: parseCssColor(paint['color']! as String),
      style: _borderStyle(paint['style']! as String),
    ),
  );
}

RitoBorderStyle _borderStyle(String name) {
  return switch (name) {
    'none' => RitoBorderStyle.none,
    'hidden' => RitoBorderStyle.hidden,
    'dotted' => RitoBorderStyle.dotted,
    'dashed' => RitoBorderStyle.dashed,
    'solid' => RitoBorderStyle.solid,
    'double' => RitoBorderStyle.double,
    'groove' => RitoBorderStyle.groove,
    'ridge' => RitoBorderStyle.ridge,
    'inset' => RitoBorderStyle.inset,
    'outset' => RitoBorderStyle.outset,
    _ => throw FormatException('unknown border style: $name'),
  };
}

RitoDisplayRect _rect(Object? json) {
  final map = json! as Map<String, Object?>;
  return RitoDisplayRect(
    x: _double(map['x']),
    y: _double(map['y']),
    width: _double(map['width']),
    height: _double(map['height']),
  );
}

RitoLength _length(Object json) {
  final map = json as Map<String, Object?>;
  final unit = map['unit']! as String;
  final value = _double(map['value']);
  return unit == 'percent' ? RitoPercentLength(value) : RitoPxLength(value);
}

double _double(Object? value) => (value! as num).toDouble();

RitoColor? _color(Object? css) =>
    css == null ? null : parseCssColor(css as String);

/// Parses the CSS color subset the parity corpus uses: hex, rgb()/rgba(),
/// and color(display-p3 ...).
RitoColor parseCssColor(String css) {
  final text = css.trim();
  if (text.startsWith('#')) {
    return _hexColor(text);
  }
  if (text.startsWith('rgb')) {
    final inner = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    final parts = inner.split(RegExp(r'[,\s/]+')).where((p) => p.isNotEmpty).toList();
    return _srgb(
      double.parse(parts[0]) / 255,
      double.parse(parts[1]) / 255,
      double.parse(parts[2]) / 255,
      parts.length > 3 ? double.parse(parts[3]) : 1,
    );
  }
  if (text.startsWith('color(display-p3')) {
    final inner = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
    final parts = inner
        .split(RegExp(r'[\s/]+'))
        .where((p) => p.isNotEmpty)
        .skip(1)
        .toList();
    return RitoColor(
      space: RitoColorSpace.displayP3,
      component0: double.parse(parts[0]),
      component1: double.parse(parts[1]),
      component2: double.parse(parts[2]),
      alpha: parts.length > 3 ? double.parse(parts[3]) : 1,
      none: const RitoColorNoneFlags(
        component0: false,
        component1: false,
        component2: false,
        alpha: false,
      ),
    );
  }
  throw FormatException('unsupported parity color: $css');
}

RitoColor _hexColor(String hex) {
  final digits = hex.substring(1);
  final expanded = digits.length == 3
      ? digits.split('').map((d) => '$d$d').join()
      : digits;
  final value = int.parse(expanded.padRight(8, 'f'), radix: 16);
  return _srgb(
    ((value >> 24) & 0xff) / 255,
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  );
}

RitoColor _srgb(double r, double g, double b, double a) {
  return RitoColor(
    space: RitoColorSpace.srgb,
    component0: r,
    component1: g,
    component2: b,
    alpha: a,
    none: const RitoColorNoneFlags(
      component0: false,
      component1: false,
      component2: false,
      alpha: false,
    ),
  );
}

/// Synthetic image sources — must stay byte-identical with
/// harness/entry.ts `syntheticPixels`.
Future<ui.Image?> makeSyntheticImage(String src) async {
  final pixels = _syntheticPixels(src);
  if (pixels == null) return null;
  final completer = Completer<ui.Image>();
  ui.decodeImageFromPixels(
    pixels.rgba,
    pixels.width,
    pixels.height,
    ui.PixelFormat.rgba8888,
    completer.complete,
  );
  return completer.future;
}

final class _SyntheticPixels {
  _SyntheticPixels(this.width, this.height, this.rgba);

  final int width;
  final int height;
  final Uint8List rgba;
}

_SyntheticPixels? _syntheticPixels(String src) {
  if (src == 'synthetic:checker16') {
    return _fillPixels(16, 16, (x, y) {
      return ((x >> 2) + (y >> 2)) % 2 == 0
          ? const [255, 0, 0, 255]
          : const [0, 0, 255, 255];
    });
  }
  if (src == 'synthetic:gradient32') {
    return _fillPixels(32, 32, (x, y) {
      final r = (x * 255) ~/ 31;
      return [r, (y * 255) ~/ 31, 255 - r, 255];
    });
  }
  if (src == 'synthetic:dot8') {
    return _fillPixels(8, 8, (x, y) {
      return x >= 3 && x <= 4 && y >= 3 && y <= 4
          ? const [0, 0, 0, 255]
          : const [255, 255, 255, 255];
    });
  }
  return null;
}

_SyntheticPixels _fillPixels(
  int width,
  int height,
  List<int> Function(int x, int y) pixel,
) {
  final rgba = Uint8List(width * height * 4);
  for (var y = 0; y < height; y += 1) {
    for (var x = 0; x < width; x += 1) {
      final p = pixel(x, y);
      final offset = (y * width + x) * 4;
      rgba[offset] = p[0];
      rgba[offset + 1] = p[1];
      rgba[offset + 2] = p[2];
      rgba[offset + 3] = p[3];
    }
  }
  return _SyntheticPixels(width, height, rgba);
}
