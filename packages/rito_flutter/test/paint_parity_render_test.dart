// Flutter-pen half of the paint-parity instrument
// (tools/paint-parity/run.mjs). Renders every fixture through
// RitoCanvasPaintTarget into RITO_PAINT_PARITY_OUT/flutter/<name>.png
// for the pixel diff against the calibrated browser painter. Skips
// entirely when the instrument env vars are absent so the normal test
// suite never touches the filesystem.
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
  final fixtureRoot = Platform.environment['RITO_PAINT_PARITY_FIXTURES'];

  test('render paint-parity fixtures', () async {
    if (outRoot == null || fixtureRoot == null) {
      markTestSkipped('RITO_PAINT_PARITY_OUT not set; parity render skipped.');
      return;
    }
    await _loadSharedFonts();

    final outDir = Directory('$outRoot/flutter')..createSync(recursive: true);
    final files =
        Directory(fixtureRoot)
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));
    expect(files, isNotEmpty, reason: 'no fixtures found in $fixtureRoot');

    for (final file in files) {
      // A fixture the Flutter pen cannot express yet must surface as a
      // missing render in the diff report, not abort the whole batch.
      try {
        await _renderFixture(file, outDir);
      } on Object catch (error) {
        stderr.writeln('parity fixture failed: ${file.path}: $error');
      }
    }

    // The lowered lane: the engine's format-2 bytes for each fixture
    // (written by rito-core's lower_paint_parity_fixtures) through the
    // production decoder and the primitive blitter.
    final loweredRoot = Directory('$outRoot/lowered');
    if (!loweredRoot.existsSync()) {
      return;
    }
    final loweredOut = Directory('$outRoot/flutter-lowered')
      ..createSync(recursive: true);
    final lowered =
        loweredRoot
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));
    for (final file in lowered) {
      try {
        await _renderLoweredFixture(file, loweredOut);
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
  final images = await _prepareLoweredImages(list);
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
            foreground: ritoUiColor(parseCssColor(theme['foreground']! as String)),
            background: ritoUiColor(parseCssColor(theme['background']! as String)),
          ),
  );
  const RitoPrimitiveListReplayer().replay(list, target);
  final image = await recorder.endRecording().toImage(width, height);
  final pngBytes = await image.toByteData(format: ui.ImageByteFormat.png);
  File(
    '${outDir.path}/$name.png',
  ).writeAsBytesSync(pngBytes!.buffer.asUint8List());
}

Future<Map<String, ui.Image>> _prepareLoweredImages(
  RitoPrimitiveList list,
) async {
  final images = <String, ui.Image>{};
  for (final primitive in list.commands) {
    final src = switch (primitive) {
      RitoPrimitiveDrawImage(:final src) => src,
      RitoPrimitiveBlock(:final command) => command.paint.background?.image,
      _ => null,
    };
    if (src == null || images.containsKey(src)) continue;
    final image = await makeSyntheticImage(src);
    if (image != null) images[src] = image;
  }
  return images;
}

Future<void> _renderFixture(File file, Directory outDir) async {
  final fixture = parseParityFixture(
    jsonDecode(file.readAsStringSync()) as Map<String, Object?>,
  );
  final images = await _prepareImages(fixture.commands);
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  final background = fixture.background;
  if (background != null) {
    canvas.drawRect(
      ui.Rect.fromLTWH(
        0,
        0,
        fixture.width.toDouble(),
        fixture.height.toDouble(),
      ),
      ui.Paint()..color = ritoUiColor(background),
    );
  }
  final themeForeground = fixture.themeForeground;
  final themeBackground = fixture.themeBackground;
  final target = RitoCanvasPaintTarget(
    canvas,
    resolveImage: (href) => images[href],
    fontEnvelopes: _fontEnvelopes,
    colorOverride: themeForeground == null || themeBackground == null
        ? null
        : RitoCanvasColorOverride(
            foreground: ritoUiColor(themeForeground),
            background: ritoUiColor(themeBackground),
          ),
  );
  final displayList = RitoDisplayList(
    formatVersion: 1,
    commands: fixture.commands,
  );
  // Same order as the production surface: preflight validates and
  // prepares block paints before replay.
  target.preflightPaintCapabilities(displayList);
  const RitoDisplayListReplayer().replay(displayList, target);
  final image = await recorder.endRecording().toImage(
    fixture.width,
    fixture.height,
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  File(
    '${outDir.path}/${fixture.name}.png',
  ).writeAsBytesSync(bytes!.buffer.asUint8List());
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

Future<Map<String, ui.Image>> _prepareImages(List<RitoCommand> commands) async {
  final images = <String, ui.Image>{};
  for (final command in commands) {
    final src = switch (command) {
      RitoPaintImage(:final src) => src,
      RitoPaintBlock(:final paint) => paint.background?.image,
      _ => null,
    };
    if (src == null || images.containsKey(src)) continue;
    final image = await makeSyntheticImage(src);
    if (image != null) images[src] = image;
  }
  return images;
}
