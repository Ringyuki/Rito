// Decodes and replays bytes the live Rust encoder wrote
// (packages/rito-core-wasm/tests/fixtures/reader-session-primitive-list.hex,
// kept in step by crates/rito-core's
// cross_language_wire_fixture_matches_the_encoder test). A hand-built fixture can agree with a stale reading of the wire;
// these cannot.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';

Uint8List _fixture(String name) {
  final hex = File(
    '../../packages/rito-core-wasm/tests/fixtures/$name',
  ).readAsStringSync().trim();
  final bytes = Uint8List(hex.length ~/ 2);
  for (var index = 0; index < bytes.length; index += 1) {
    bytes[index] = int.parse(
      hex.substring(2 * index, 2 * index + 2),
      radix: 16,
    );
  }
  return bytes;
}

void main() {
  test('the decoder reads every optional tail the encoder writes', () {
    // The fixture is lowered at ratio 2, but a text run keeps its CSS
    // lengths: the pen paints it under the ratio.
    final list = const RitoPrimitiveListDecoder().decode(
      _fixture('reader-session-primitive-list.hex'),
    );
    final text = (list.commands[11] as RitoPrimitiveText).command;
    expect(text.paint.font.sizePx, 16);
    expect(text.paint.font.style, RitoFontStyle.italic);
    expect(text.paint.textShadows.single.blur, 3);
    expect(text.lineHeightPx, 18.5);
    expect(text.href, '#note');
    expect(text.sourceText, 'source');
    expect(text.sourceTextOffset, 9);
    expect(text.clusters.map((c) => (c.byte, c.x, c.y)), [
      (0, 0.0, 12.5),
      (1, 8.5, 12.5),
      (2, 12.25, 12.5),
      (3, 16.0, 12.5),
    ]);
  });

  test('decodes every primitive the Rust encoder writes', () {
    final list = const RitoPrimitiveListDecoder().decode(
      _fixture('reader-session-primitive-list.hex'),
    );
    expect(list.formatVersion, RitoPrimitiveListDecoder.formatVersion);
    expect(list.ratio, 2);
    expect(
      list.commands.map((primitive) => primitive.opcode),
      List<int>.generate(13, (index) => index + 1),
    );
    final transform = list.commands[4] as RitoPrimitiveTransform;
    expect(transform.origin.x, 1);
    expect(transform.transforms, <Matcher>[
      isA<RitoDeviceRotate>(),
      isA<RitoDeviceScale>(),
      isA<RitoDeviceTranslate>(),
    ]);
    expect((transform.transforms[2] as RitoDeviceTranslate).dy, 5);
    final clip = list.commands[5] as RitoPrimitiveClipPath;
    expect(clip.path.ops, <Matcher>[
      isA<RitoPathMoveTo>(),
      isA<RitoPathLineTo>(),
      isA<RitoPathArc>(),
      isA<RitoPathEllipse>(),
      isA<RitoPathRect>(),
      isA<RitoPathClose>(),
    ]);
    expect((clip.path.ops[2] as RitoPathArc).sweep, 1.5);
    final fill = list.commands[6] as RitoPrimitiveFillRect;
    expect(fill.rect.width, 40);
    expect(fill.ground, RitoFillGround.page);
    expect(fill.color.component2, closeTo(0.75, 1e-9));
    final fillPath = list.commands[7] as RitoPrimitiveFillPath;
    expect(fillPath.rule, RitoFillRule.evenOdd);
    expect(fillPath.ground, RitoFillGround.block);
    expect(fillPath.groundRect?.width, 39);
    expect(fill.groundRect, isNull);
    final stroke = list.commands[8] as RitoPrimitiveStrokePath;
    expect(stroke.width, 1.5);
    expect(stroke.cap, RitoStrokeCap.round);
    expect(stroke.dash?.off, 2);
    final shadow = list.commands[9] as RitoPrimitiveShadow;
    expect(shadow.sigma, 1.5);
    expect(shadow.clipOut?.ops.length, 6);
    final image = list.commands[10] as RitoPrimitiveDrawImage;
    expect(image.src, 'images/cover.jpg');
    expect(image.sourceRect, isNull);
    expect(image.tiles?.columns, 2);
    expect(image.tiles?.rows, 3);
    final text = list.commands[11] as RitoPrimitiveText;
    expect(text.command.text, 'text');
    expect(text.command.lineHeightPx, 18.5);
    expect(list.commands[12], isA<RitoPrimitiveRuby>());
  });

  test('rejects format 1, every truncated prefix and trailing bytes', () {
    const decoder = RitoPrimitiveListDecoder();
    final fixture = _fixture('reader-session-primitive-list.hex');
    final formatOne = Uint8List.fromList(fixture)
      ..setRange(7, 11, <int>[1, 0, 0, 0]);
    expect(() => decoder.decode(formatOne), throwsA(isA<RitoWireException>()));
    for (var end = 0; end < fixture.length; end += 1) {
      expect(
        () => decoder.decode(Uint8List.sublistView(fixture, 0, end)),
        throwsA(isA<RitoWireException>()),
        reason: 'primitive prefix $end must fail',
      );
    }
    final trailing = Uint8List(fixture.length + 1)..setAll(0, fixture);
    expect(() => decoder.decode(trailing), throwsA(isA<RitoWireException>()));
  });

  test('replays every primitive in order and blits it onto a canvas', () {
    final list = const RitoPrimitiveListDecoder().decode(
      _fixture('reader-session-primitive-list.hex'),
    );
    final recording = _RecordingTarget();
    const RitoPrimitiveListReplayer().replay(list, recording);
    expect(recording.calls, <String>[
      'save',
      'restore',
      'translate',
      'opacity',
      'transform',
      'clipPath',
      'fillRect',
      'fillPath',
      'strokePath',
      'shadow',
      'drawImage',
      'text',
      'ruby',
    ]);

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    final target = RitoPrimitiveCanvasTarget(canvas, resolveImage: (_) => null);
    const RitoPrimitiveListReplayer().replay(list, target);
    expect(recorder.endRecording(), isNotNull);
  });
}

final class _RecordingTarget implements RitoPrimitiveTarget {
  final List<String> calls = <String>[];

  @override
  void save() => calls.add('save');

  @override
  void restore() => calls.add('restore');

  @override
  void translate(RitoPrimitiveTranslate primitive) => calls.add('translate');

  @override
  void opacity(RitoPrimitiveOpacity primitive) => calls.add('opacity');

  @override
  void transform(RitoPrimitiveTransform primitive) => calls.add('transform');

  @override
  void clipPath(RitoPrimitiveClipPath primitive) => calls.add('clipPath');

  @override
  void fillRect(RitoPrimitiveFillRect primitive) => calls.add('fillRect');

  @override
  void fillPath(RitoPrimitiveFillPath primitive) => calls.add('fillPath');

  @override
  void strokePath(RitoPrimitiveStrokePath primitive) => calls.add('strokePath');

  @override
  void shadow(RitoPrimitiveShadow primitive) => calls.add('shadow');

  @override
  void drawImage(RitoPrimitiveDrawImage primitive) => calls.add('drawImage');

  @override
  void text(RitoPrimitiveText primitive) => calls.add('text');

  @override
  void ruby(RitoPrimitiveRuby primitive) => calls.add('ruby');
}
