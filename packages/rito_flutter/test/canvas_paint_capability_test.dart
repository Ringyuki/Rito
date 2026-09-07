import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';

// The engine resolves every block law before the bytes reach the host, so
// the only paint the Flutter pen can still refuse is a text run whose
// inline border style has no Canvas stroke. It must refuse before any ink
// is recorded, never approximate with a different style.
void main() {
  test('3D inline border styles fail instead of painting a solid line', () {
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
        () => target.paintText(_text(borderStyle: style)),
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

  test('unsupported inline border fails before text is painted', () async {
    final recorder = ui.PictureRecorder();
    final target = _target(recorder);

    expect(
      () => target.paintText(_text(borderStyle: RitoBorderStyle.outset)),
      throwsUnsupportedError,
    );
    await _expectTransparent(recorder, width: 8, height: 8);
  });

  test('the primitive replayer refuses a text run through the same gate', () {
    final recorder = ui.PictureRecorder();
    final target = _target(recorder);
    final list = RitoPrimitiveList(
      formatVersion: 2,
      ratio: 1,
      commands: <RitoPrimitive>[
        RitoPrimitiveText(_text(borderStyle: RitoBorderStyle.groove)),
      ],
    );

    expect(
      () => const RitoPrimitiveListReplayer().replay(list, target),
      throwsUnsupportedError,
    );
    recorder.endRecording().dispose();
  });
}

RitoPrimitiveCanvasTarget _target(ui.PictureRecorder recorder) {
  return RitoPrimitiveCanvasTarget(
    ui.Canvas(recorder),
    resolveImage: (href) => null,
  );
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

Future<void> _expectTransparent(
  ui.PictureRecorder recorder, {
  required int width,
  required int height,
}) async {
  final image = await recorder.endRecording().toImage(width, height);
  final bytes = await image.toByteData();
  final pixels = bytes!.buffer.asUint8List();
  for (var index = 3; index < pixels.length; index += 4) {
    expect(pixels[index], 0, reason: 'pixel ${index ~/ 4} must stay clear');
  }
}
