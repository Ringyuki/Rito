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
import 'package:rito_flutter/src/render/typed_color.dart';

import 'support/parity_fixture_loader.dart';

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
  });
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
  final target = RitoCanvasPaintTarget(
    canvas,
    resolveImage: (href) => images[href],
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

Future<Map<String, ui.Image>> _prepareImages(
  List<RitoCommand> commands,
) async {
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
