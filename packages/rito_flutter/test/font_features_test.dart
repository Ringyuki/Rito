import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

/// A face's vertical forms: the same bytes the engine lists again under a
/// family of their own with `vert` on, which this pen turns on for every
/// run drawn in that family.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a family registered with features paints with them on', () {
    final store = RitoFontEnvelopeStore()
      ..registerFeatures('forms', const [
        RitoFontFeature(tag: 'vert', value: 1),
      ])
      ..registerFeatures('plain', const []);

    expect(store.featuresOf('forms'), [const ui.FontFeature('vert', 1)]);
    expect(store.featuresOf('plain'), isNull);
    expect(store.featuresOf('unknown'), isNull);
  });

  test('vert draws a bracket in its vertical form', () async {
    final bytes = File(
      '../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf',
    ).readAsBytesSync();
    await (FontLoader(
      'VerticalFormsProbe',
    )..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)))).load();

    Future<List<int>> pixels(List<ui.FontFeature> features) async {
      final builder = ui.ParagraphBuilder(ui.ParagraphStyle(fontSize: 40))
        ..pushStyle(
          ui.TextStyle(
            fontFamily: 'VerticalFormsProbe',
            fontSize: 40,
            fontFeatures: features,
            color: const ui.Color(0xff000000),
          ),
        )
        ..addText('「');
      final paragraph = builder.build()
        ..layout(const ui.ParagraphConstraints(width: 80));
      final recorder = ui.PictureRecorder();
      ui.Canvas(recorder)
        ..drawRect(
          const ui.Rect.fromLTWH(0, 0, 80, 80),
          ui.Paint()..color = const ui.Color(0xffffffff),
        )
        ..drawParagraph(paragraph, ui.Offset.zero);
      final picture = recorder.endRecording();
      final image = await picture.toImage(80, 80);
      picture.dispose();
      final data = (await image.toByteData())!.buffer.asUint8List();
      image.dispose();
      return [for (var i = 0; i < data.length; i += 4) data[i]];
    }

    final plain = await pixels(const []);
    final forms = await pixels(const [ui.FontFeature('vert', 1)]);
    var differing = 0;
    for (var i = 0; i < plain.length; i += 1) {
      if (plain[i] != forms[i]) differing += 1;
    }
    expect(differing, greaterThan(100));
  });
}
