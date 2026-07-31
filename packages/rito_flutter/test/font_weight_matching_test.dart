import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

/// How CSS and Flutter disagree about font weight, and what the pen has
/// to do about it.
///
/// CSS matches a face by its `@font-face` descriptor; Flutter matches by
/// the file's own `OS/2.usWeightClass`. A book that ships one file and
/// declares it as its bold is the case where the two part ways.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Uint8List regularBytes;

  setUpAll(() async {
    regularBytes = File(
      '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
    ).readAsBytesSync();
  });

  Future<void> loadFace(String family, Uint8List bytes) async {
    await (FontLoader(family)
          ..addFont(Future<ByteData>.value(ByteData.sublistView(bytes))))
        .load();
  }

  Future<int> inkOf(ui.TextStyle style, String text) async {
    final builder = ui.ParagraphBuilder(ui.ParagraphStyle(fontSize: 40))
      ..pushStyle(style)
      ..addText(text);
    final paragraph = builder.build()
      ..layout(const ui.ParagraphConstraints(width: 500));
    final recorder = ui.PictureRecorder();
    ui.Canvas(recorder)
      ..drawRect(
        const ui.Rect.fromLTWH(0, 0, 500, 80),
        ui.Paint()..color = const ui.Color(0xffffffff),
      )
      ..drawParagraph(paragraph, ui.Offset.zero);
    final picture = recorder.endRecording();
    final image = await picture.toImage(500, 80);
    picture.dispose();
    final data = (await image.toByteData())!.buffer.asUint8List();
    image.dispose();
    var ink = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i] < 128) ink += 1;
    }
    return ink;
  }

  test('a weight mismatch synthesizes instead of falling through', () async {
    // The premise behind "single-file embedded fonts get pierced":
    // Flutter is claimed to skip a family whose weight does not match.
    // It does not — it stays and emboldens, exactly like the browser.
    await loadFace('WeightProbeSolo', regularBytes);
    await loadFace(
      'WeightProbeBold',
      File(
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
      ).readAsBytesSync(),
    );

    const text = 'Hamburgefonstiv';
    const black = ui.Color(0xff000000);
    final soloAlone = await inkOf(
      ui.TextStyle(
        fontFamily: 'WeightProbeSolo',
        fontWeight: ui.FontWeight.w700,
        color: black,
      ),
      text,
    );
    final stacked = await inkOf(
      ui.TextStyle(
        fontFamily: 'WeightProbeSolo',
        fontFamilyFallback: <String>['WeightProbeBold'],
        fontWeight: ui.FontWeight.w700,
        color: black,
      ),
      text,
    );
    final boldAlone = await inkOf(
      ui.TextStyle(
        fontFamily: 'WeightProbeBold',
        fontWeight: ui.FontWeight.w700,
        color: black,
      ),
      text,
    );

    expect(
      stacked,
      soloAlone,
      reason: 'a bold run must stay on the family that has the glyphs',
    );
    expect(
      stacked,
      isNot(boldAlone),
      reason: 'the real-bold fallback must not capture a weight mismatch',
    );

    final soloRegular = await inkOf(
      ui.TextStyle(
        fontFamily: 'WeightProbeSolo',
        fontWeight: ui.FontWeight.w400,
        color: black,
      ),
      text,
    );
    expect(
      soloAlone,
      greaterThan(soloRegular),
      reason: 'the missing bold is synthesized, not silently dropped',
    );
  }, skip: !File('/System/Library/Fonts/Supplemental/Arial Bold.ttf').existsSync());

  test('a face the book declares as bold is not emboldened again', () async {
    // A single file declared `font-weight: 700`. CSS paints it as-is;
    // Flutter would embolden it because the file itself says 400.
    RitoFontEnvelopeStore.shared.register(
      'DeclaredBoldFace',
      regularBytes,
      declaredWeight: 700,
    );
    RitoFontEnvelopeStore.shared.register(
      'DeclaredRegularFace',
      regularBytes,
      declaredWeight: 400,
    );

    final declaredBold = RitoFontEnvelopeStore.shared.lookup(
      'DeclaredBoldFace',
    )!;
    final declaredRegular = RitoFontEnvelopeStore.shared.lookup(
      'DeclaredRegularFace',
    )!;

    // The file is a Regular; only the declaration differs.
    expect(declaredBold.fileWeightClass, lessThan(600));
    expect(declaredBold.declaredBold, isTrue);
    expect(declaredRegular.declaredBold, isFalse);
    expect(RitoFontEnvelopeStore.shared.faceCount('DeclaredBoldFace'), 1);
  });
}
