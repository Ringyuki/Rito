import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// What positioned cluster runs cost on the Flutter pen — the question
/// the glyph-run vocabulary hangs on.
///
/// A page of CJK body text is ~900 clusters. Four pens paint it 20 times
/// each: one TextPainter per run (today), one TextPainter per cluster
/// laid out on every paint, one ui.Paragraph per (cluster, style) cached
/// across paints, and the same cache with every cluster at a fractional
/// x. Measured on 2026-09-08 (flutter_tester, Source Han Serif 16px):
/// 398, 8067, 253 and 134 µs per page — a per-cluster pen with a
/// paragraph cache is cheaper than today's per-run TextPainter, while
/// laying every cluster out on every paint is twenty times dearer.
/// Run on demand: `flutter test test/spike --run-skipped`.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const family = 'RitoSpikeFace';
  setUpAll(() async {
    final bytes = File(
      '../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf',
    ).readAsBytesSync();
    await (FontLoader(
      family,
    )..addFont(Future<ByteData>.value(ByteData.sublistView(bytes)))).load();
  });

  const sample =
      '春日的剧场里，凉宫团长把整个社团的命运押在一场没有剧本的演出上，'
      '而观众席上只有一位沉默的神明。';
  const columns = 36;
  const rows = 25;
  const size = 16.0;
  const lineHeight = 26.0;

  List<String> clusters() {
    final runes = sample.runes.map(String.fromCharCode).toList();
    return List<String>.generate(columns, (i) => runes[i % runes.length]);
  }

  TextStyle style() => const TextStyle(
    fontFamily: family,
    fontSize: size,
    color: ui.Color(0xff000000),
  );

  int timePages(String name, void Function(ui.Canvas canvas) paintPage) {
    // Warm up once, then time 20 paints into fresh recorders.
    final warm = ui.PictureRecorder();
    paintPage(ui.Canvas(warm));
    warm.endRecording().dispose();
    final watch = Stopwatch()..start();
    const pages = 20;
    for (var page = 0; page < pages; page += 1) {
      final recorder = ui.PictureRecorder();
      paintPage(ui.Canvas(recorder));
      recorder.endRecording().dispose();
    }
    watch.stop();
    final perPage = watch.elapsedMicroseconds ~/ pages;
    // ignore: avoid_print
    print('$name: $perPage us/page');
    return perPage;
  }

  test('per-cluster painting cost', skip: 'spike: run with --run-skipped', () {
    final row = clusters();
    final line = row.join();
    final perRun = timePages('one TextPainter per run   ', (canvas) {
      for (var r = 0; r < rows; r += 1) {
        final painter = TextPainter(
          text: TextSpan(text: line, style: style()),
          textDirection: ui.TextDirection.ltr,
          maxLines: 1,
        )..layout();
        painter.paint(canvas, ui.Offset(20, 20 + r * lineHeight));
      }
    });
    final perCluster = timePages('one TextPainter per cluster', (canvas) {
      for (var r = 0; r < rows; r += 1) {
        for (var c = 0; c < columns; c += 1) {
          final painter = TextPainter(
            text: TextSpan(text: row[c], style: style()),
            textDirection: ui.TextDirection.ltr,
            maxLines: 1,
          )..layout();
          painter.paint(canvas, ui.Offset(20 + c * size, 20 + r * lineHeight));
        }
      }
    });
    final cache = <String, ui.Paragraph>{};
    ui.Paragraph paragraphFor(String cluster) {
      return cache.putIfAbsent(cluster, () {
        final builder =
            ui.ParagraphBuilder(
                ui.ParagraphStyle(
                  fontFamily: family,
                  fontSize: size,
                  maxLines: 1,
                ),
              )
              ..pushStyle(ui.TextStyle(color: const ui.Color(0xff000000)))
              ..addText(cluster);
        return builder.build()
          ..layout(const ui.ParagraphConstraints(width: 1000));
      });
    }

    final cached = timePages('cached Paragraph per cluster', (canvas) {
      for (var r = 0; r < rows; r += 1) {
        for (var c = 0; c < columns; c += 1) {
          canvas.drawParagraph(
            paragraphFor(row[c]),
            ui.Offset(20 + c * size, 20 + r * lineHeight),
          );
        }
      }
    });
    final glyphs = <String, ui.Paragraph>{};
    ui.Paragraph glyphParagraph(String cluster) =>
        glyphs.putIfAbsent(cluster, () {
          final builder =
              ui.ParagraphBuilder(
                  ui.ParagraphStyle(
                    fontFamily: family,
                    fontSize: size,
                    maxLines: 1,
                  ),
                )
                ..pushStyle(ui.TextStyle(color: const ui.Color(0xff000000)))
                ..addText(cluster);
          return builder.build()
            ..layout(const ui.ParagraphConstraints(width: 1000));
        });
    // A paint that positions every cluster at a fractional device x, the
    // way a positioned run would.
    final fractional = timePages('cached Paragraph, 1/64 x    ', (canvas) {
      for (var r = 0; r < rows; r += 1) {
        for (var c = 0; c < columns; c += 1) {
          canvas.drawParagraph(
            glyphParagraph(row[c]),
            ui.Offset(20 + c * size + (c % 4) / 64, 20 + r * lineHeight),
          );
        }
      }
    });
    expect(perRun, greaterThan(0));
    expect(perCluster, greaterThan(0));
    expect(cached, greaterThan(0));
    expect(fractional, greaterThan(0));
  });
}
