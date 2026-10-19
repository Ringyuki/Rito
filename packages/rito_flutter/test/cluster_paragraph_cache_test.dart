import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';
import 'package:rito_flutter/src/render/cluster_paragraph_cache.dart';

import 'support/image_cache_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const family = 'RitoParagraphCacheTestFace';

  setUpAll(() async {
    final bytes = File(
      '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
    ).readAsBytesSync();
    await (FontLoader(
      family,
    )..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)))).load();
  });

  test('drops the least recently used paragraph once past capacity', () {
    final cache = RitoClusterParagraphCache(capacity: 2);
    RitoClusterParagraphKey key(String text) =>
        (text, family, 16, 400, false, 0xff000000);
    ui.Paragraph lookup(String text) => cache.lookup(key(text), () {
      final builder = ui.ParagraphBuilder(ui.ParagraphStyle())..addText(text);
      return builder.build()
        ..layout(const ui.ParagraphConstraints(width: double.infinity));
    });

    lookup('a');
    lookup('b');
    lookup('a');
    lookup('c');
    expect(cache.builds, 3);

    // 'a' was looked up after 'b', so 'b' made room for 'c'.
    lookup('a');
    expect(cache.builds, 3);
    lookup('b');
    expect(cache.builds, 4);
  });

  test('a page painted again by another painter lays out none of its '
      'characters, and the next page only its new ones', () {
    final shared = RitoClusterParagraphCache.shared;
    final before = shared.builds;
    _paint(_page('RitoParagraphCacheTestPageFace', 'abca')).dispose();
    expect(shared.builds - before, 3, reason: 'a, b and c');

    _paint(_page('RitoParagraphCacheTestPageFace', 'abca')).dispose();
    expect(shared.builds - before, 3);

    _paint(_page('RitoParagraphCacheTestPageFace', 'bad')).dispose();
    expect(shared.builds - before, 4, reason: 'only d is new');
  });

  test('clusters that join the one before them paint in its string', () {
    final shared = RitoClusterParagraphCache.shared;
    final before = shared.builds;
    _paint(
      _page('RitoParagraphCacheTestJoinFace', 'xyz', joined: true),
    ).dispose();
    expect(shared.builds - before, 1, reason: 'one string, xyz');
  });

  test('a page in a theme paints the theme ink after the same characters '
      'were painted in the book ink', () async {
    const theme = RitoCanvasColorOverride(
      foreground: ui.Color(0xffffffff),
      background: ui.Color(0xff000000),
    );
    final page = _page(family, 'Ink');

    final plain = await _image(_paint(page));
    final themed = await _image(_paint(page, colorOverride: theme));

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder)..drawRect(_bounds, _ground);
    const RitoPrimitiveListReplayer().replay(
      page.artifact.displayList.displayList,
      RitoPrimitiveCanvasTarget(
        canvas,
        resolveImage: (_) => null,
        colorOverride: theme,
      ),
    );
    final alone = await _image(recorder.endRecording());

    expect(themed, isNot(equals(plain)), reason: 'the theme changes the ink');
    expect(themed, equals(alone));
  });
}

const ui.Rect _bounds = ui.Rect.fromLTWH(0, 0, 80, 40);
final ui.Paint _ground = ui.Paint()..color = const ui.Color(0xff808080);

/// One run of [text] in [family], a cluster per character 12 px apart;
/// with [joined], every cluster after the first joins the one before it.
RitoPreparedArtifact _page(String family, String text, {bool joined = false}) {
  return RitoPreparedArtifact.forTest(
    imageArtifact(
      artifactId: 7100,
      hrefs: const <String>[],
      commands: <RitoPrimitive>[
        RitoPrimitiveText(
          RitoPaintText(
            text: text,
            rect: RitoDisplayRect(
              x: 4,
              y: 10,
              width: 12.0 * text.length,
              height: 20,
            ),
            paint: RitoRunPaint(
              font: RitoFontPaint(
                family: family,
                sizePx: 16,
                weight: 400,
                style: RitoFontStyle.normal,
              ),
              color: const RitoColor(
                space: RitoColorSpace.srgb,
                component0: 0,
                component1: 0,
                component2: 0,
                alpha: 1,
                none: RitoColorNoneFlags(
                  component0: false,
                  component1: false,
                  component2: false,
                  alpha: false,
                ),
              ),
              textShadows: const <RitoTextShadow>[],
            ),
            clusters: RitoClusters(
              bytes: Uint32List.fromList(<int>[
                for (var index = 0; index < text.length; index += 1) index,
              ]),
              origins: Float32List.fromList(<double>[
                for (var index = 0; index < text.length; index += 1) ...[
                  4 + 12.0 * index,
                  26,
                ],
              ]),
              joins: Uint8List.fromList(<int>[
                for (var index = 0; index < text.length; index += 1)
                  joined && index > 0 ? 1 : 0,
              ]),
            ),
          ),
        ),
      ],
    ),
  );
}

ui.Picture _paint(
  RitoPreparedArtifact page, {
  RitoCanvasColorOverride? colorOverride,
}) {
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder)..drawRect(_bounds, _ground);
  RitoArtifactPainter(
    artifact: page,
    resolveImage: (_) => null,
    colorOverride: colorOverride,
  ).paint(canvas, _bounds.size);
  return recorder.endRecording();
}

Future<Uint8List> _image(ui.Picture picture) async {
  final image = await picture.toImage(
    _bounds.width.toInt(),
    _bounds.height.toInt(),
  );
  picture.dispose();
  final bytes = (await image.toByteData())!.buffer.asUint8List();
  image.dispose();
  return bytes;
}
