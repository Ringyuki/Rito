import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_paint_math.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';

void main() {
  test('box-shadow blur radius uses Flutter and Skia sigma conversion', () {
    expect(ritoCanvasShadowSigma(0), 0);
    expect(ritoCanvasShadowSigma(6), closeTo(3.9641, 1e-6));
    expect(ritoCanvasShadowSigma(6), isNot(3));
  });

  test('inset box-shadow fails before any block paint is recorded', () async {
    final recorder = ui.PictureRecorder();
    final target = _target(recorder);

    expect(
      () => target.paintBlock(_block(shadowInset: true)),
      throwsA(
        isA<UnsupportedError>().having(
          (error) => error.message,
          'message',
          contains('inset box-shadow'),
        ),
      ),
    );
    await _expectTransparent(recorder, width: 8, height: 8);
  });

  test('display-list capability preflight leaves Canvas untouched', () async {
    final recorder = ui.PictureRecorder();
    final target = _target(recorder);
    final displayList = RitoDisplayList(
      formatVersion: 1,
      commands: <RitoCommand>[
        const RitoPaintPage(
          rect: RitoDisplayRect(x: 0, y: 0, width: 8, height: 8),
          paint: RitoPagePaint(backgroundColor: _red),
        ),
        _block(shadowInset: true),
      ],
    );

    expect(
      () => target.preflightPaintCapabilities(displayList),
      throwsUnsupportedError,
    );
    await _expectTransparent(recorder, width: 8, height: 8);
  });

  test('3D border styles fail instead of painting a solid line', () {
    const styles = <RitoBorderStyle>[
      RitoBorderStyle.groove,
      RitoBorderStyle.ridge,
      RitoBorderStyle.inset,
      RitoBorderStyle.outset,
    ];
    for (final style in styles) {
      final recorder = ui.PictureRecorder();
      final target = _target(recorder);
      expect(
        () => target.paintHorizontalRule(
          RitoPaintHorizontalRule(
            rect: const RitoDisplayRect(x: 0, y: 0, width: 8, height: 2),
            paint: RitoHorizontalRulePaint(color: _red, style: style),
          ),
        ),
        throwsA(
          isA<UnsupportedError>().having(
            (error) => error.message,
            'message',
            contains(style.name),
          ),
        ),
      );
      recorder.endRecording().dispose();
    }
  });

  test(
    'unsupported block border fails before its background is drawn',
    () async {
      final recorder = ui.PictureRecorder();
      final target = _target(recorder);

      expect(
        () => target.paintBlock(_block(borderStyle: RitoBorderStyle.groove)),
        throwsUnsupportedError,
      );
      await _expectTransparent(recorder, width: 8, height: 8);
    },
  );

  test('unsupported inline border fails before text is painted', () {
    final recorder = ui.PictureRecorder();
    final target = _target(recorder);

    expect(
      () => target.paintText(_text(borderStyle: RitoBorderStyle.outset)),
      throwsUnsupportedError,
    );
    recorder.endRecording().dispose();
  });

  test('oversized tile grid fails before its background is drawn', () async {
    final tile = await _tileImage();
    final recorder = ui.PictureRecorder();
    final target = _target(recorder, image: tile);
    try {
      expect(
        () => target.paintBlock(_block(image: 'tile.png', size: 100)),
        throwsA(
          isA<UnsupportedError>().having(
            (error) => error.message,
            'message',
            contains('10000 Canvas tiles'),
          ),
        ),
      );
      await _expectTransparent(recorder, width: 100, height: 100);
    } finally {
      tile.dispose();
    }
  });
}

RitoCanvasPaintTarget _target(ui.PictureRecorder recorder, {ui.Image? image}) {
  return RitoCanvasPaintTarget(
    ui.Canvas(recorder),
    resolveImage: (href) => image,
  );
}

RitoPaintBlock _block({
  bool shadowInset = false,
  RitoBorderStyle? borderStyle,
  String? image,
  double size = 8,
}) {
  return RitoPaintBlock(
    rect: RitoDisplayRect(x: 0, y: 0, width: size, height: size),
    paint: RitoBlockPaint(
      background: RitoBackgroundPaint(
        color: _red,
        image: image,
        repeat: RitoBackgroundRepeat.repeat,
      ),
      border: borderStyle == null
          ? null
          : RitoBlockBorder(
              top: RitoBorderEdgePaint(color: _red, style: borderStyle),
            ),
      boxShadows: shadowInset
          ? const <RitoBoxShadow>[
              RitoBoxShadow(
                offsetX: 0,
                offsetY: 0,
                blur: 4,
                spread: 0,
                color: _red,
                inset: true,
              ),
            ]
          : const <RitoBoxShadow>[],
    ),
    borderBox: borderStyle == null
        ? null
        : const RitoBorderBox(
            topWidth: 2,
            rightWidth: 0,
            bottomWidth: 0,
            leftWidth: 0,
          ),
  );
}

RitoPaintText _text({required RitoBorderStyle borderStyle}) {
  return RitoPaintText(
    text: 'x',
    rect: const RitoDisplayRect(x: 0, y: 0, width: 8, height: 8),
    paint: RitoRunPaint(
      font: const RitoFontPaint(
        family: '',
        sizePx: 8,
        weight: 400,
        style: RitoFontStyle.normal,
      ),
      color: _red,
      textShadows: const <RitoTextShadow>[],
      backgroundColor: _red,
      border: RitoRunBorder(
        top: RitoRunBorderEdge(
          widthPx: 2,
          paint: RitoBorderEdgePaint(color: _red, style: borderStyle),
        ),
      ),
    ),
  );
}

Future<ui.Image> _tileImage() async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawRect(
    const ui.Rect.fromLTWH(0, 0, 1, 1),
    ui.Paint()..color = const ui.Color(0xffff0000),
  );
  final picture = recorder.endRecording();
  try {
    return await picture.toImage(1, 1);
  } finally {
    picture.dispose();
  }
}

Future<void> _expectTransparent(
  ui.PictureRecorder recorder, {
  required int width,
  required int height,
}) async {
  final picture = recorder.endRecording();
  try {
    final image = await picture.toImage(width, height);
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
      expect(data, isNotNull);
      final rgba = data!.buffer.asUint8List(
        data.offsetInBytes,
        data.lengthInBytes,
      );
      final isTransparent = Iterable<int>.generate(
        rgba.length ~/ 4,
        (index) => rgba[index * 4 + 3],
      ).every((alpha) => alpha == 0);
      expect(isTransparent, isTrue);
    } finally {
      image.dispose();
    }
  } finally {
    picture.dispose();
  }
}

const RitoColor _red = RitoColor(
  space: RitoColorSpace.srgb,
  component0: 1,
  component1: 0,
  component2: 0,
  alpha: 1,
  none: RitoColorNoneFlags(
    component0: false,
    component1: false,
    component2: false,
    alpha: false,
  ),
);
