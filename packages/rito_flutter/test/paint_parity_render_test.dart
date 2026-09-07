// Flutter-pen half of the paint-parity instrument
// (tools/paint-parity/run.mjs). Decodes every fixture's engine-lowered
// RITODL1 bytes (written by rito-core's lower_paint_parity_fixtures into
// RITO_PAINT_PARITY_OUT/lowered/) with the production decoder, blits them
// through the production primitive target into
// RITO_PAINT_PARITY_OUT/flutter/<name>.png, and leaves the pixel diff
// against the browser blitter to diff.mjs. Skips entirely when the
// instrument env vars are absent so the normal test suite never touches
// the filesystem.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';
import 'package:rito_flutter/src/render/canvas_target.dart';
import 'package:rito_flutter/src/render/color_override.dart';
import 'package:rito_flutter/src/render/font_envelope.dart';
import 'package:rito_flutter/src/render/typed_color.dart';

import 'support/parity_fixture_loader.dart';

final RitoFontEnvelopeStore _fontEnvelopes = RitoFontEnvelopeStore();

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final outRoot = Platform.environment['RITO_PAINT_PARITY_OUT'];

  test('render paint-parity fixtures', () async {
    if (outRoot == null) {
      markTestSkipped('RITO_PAINT_PARITY_OUT not set; parity render skipped.');
      return;
    }
    await _loadSharedFonts();

    final loweredRoot = Directory('$outRoot/lowered');
    expect(
      loweredRoot.existsSync(),
      isTrue,
      reason: 'no lowered fixtures at ${loweredRoot.path}; lower them first',
    );
    final outDir = Directory('$outRoot/flutter')..createSync(recursive: true);
    final files =
        loweredRoot
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));
    expect(files, isNotEmpty, reason: 'no lowered fixtures in $loweredRoot');

    for (final file in files) {
      // A fixture the pen cannot blit must surface as a missing render in
      // the diff report, not abort the whole batch.
      try {
        await _renderLoweredFixture(file, outDir);
      } on Object catch (error) {
        stderr.writeln('lowered fixture failed: ${file.path}: $error');
      }
    }
  });
}

Future<void> _renderLoweredFixture(File meta, Directory outDir) async {
  final json = jsonDecode(meta.readAsStringSync()) as Map<String, Object?>;
  final name = json['name']! as String;
  final ratio = (json['ratio']! as num).toDouble();
  final width = ((json['width']! as num) * ratio).round();
  final height = ((json['height']! as num) * ratio).round();
  final bytes = File(
    meta.path.replaceAll(RegExp(r'\.json$'), '.ritodl'),
  ).readAsBytesSync();
  final list = const RitoPrimitiveListDecoder().decode(bytes);
  final images = await _prepareImages(list);
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  final background = json['background'] as String?;
  if (background != null) {
    canvas.drawRect(
      ui.Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      ui.Paint()..color = ritoUiColor(parseCssColor(background)),
    );
  }
  final theme = json['theme'] as Map<String, Object?>?;
  final target = RitoPrimitiveCanvasTarget(
    canvas,
    resolveImage: (href) => images[href],
    fontEnvelopes: _fontEnvelopes,
    colorOverride: theme == null
        ? null
        : RitoCanvasColorOverride(
            foreground: ritoUiColor(
              parseCssColor(theme['foreground']! as String),
            ),
            background: ritoUiColor(
              parseCssColor(theme['background']! as String),
            ),
          ),
  );
  const RitoPrimitiveListReplayer().replay(list, target);
  final image = await recorder.endRecording().toImage(width, height);
  final pngBytes = await image.toByteData(format: ui.ImageByteFormat.png);
  File(
    '${outDir.path}/$name.png',
  ).writeAsBytesSync(pngBytes!.buffer.asUint8List());
}

Future<Map<String, ui.Image>> _prepareImages(RitoPrimitiveList list) async {
  final images = <String, ui.Image>{};
  for (final primitive in list.commands) {
    final src = switch (primitive) {
      RitoPrimitiveDrawImage(:final src) => src,
      _ => null,
    };
    if (src == null || images.containsKey(src)) continue;
    final image = await makeSyntheticImage(src);
    if (image != null) images[src] = image;
  }
  return images;
}

Future<void> _loadSharedFonts() async {
  final repoRoot = _findRepoRoot();
  const faces = <(String, String)>[
    ('Tinos', 'apps/reader/src/assets/fonts/Tinos-Regular.ttf'),
    (
      'Source Han Serif CN',
      'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf',
    ),
  ];
  for (final (family, relative) in faces) {
    final file = File('$repoRoot/$relative');
    expect(file.existsSync(), isTrue, reason: 'shared font missing: $relative');
    final bytes = file.readAsBytesSync();
    _fontEnvelopes.register(family, bytes);
    final loader = FontLoader(family)
      ..addFont(Future.value(ByteData.view(bytes.buffer)));
    await loader.load();
  }
}

String _findRepoRoot() {
  var dir = Directory.current;
  while (!File('${dir.path}/pnpm-workspace.yaml').existsSync()) {
    final parent = dir.parent;
    if (parent.path == dir.path) {
      fail('repo root not found above ${Directory.current.path}');
    }
    dir = parent;
  }
  return dir.path;
}
