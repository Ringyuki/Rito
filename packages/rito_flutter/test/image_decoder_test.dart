import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

Future<Uint8List> rasterPng(int width, int height) async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawRect(
    ui.Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    ui.Paint()..color = const ui.Color(0xff336699),
  );
  final picture = recorder.endRecording();
  final image = await picture.toImage(width, height);
  picture.dispose();
  final bytes = (await image.toByteData(
    format: ui.ImageByteFormat.png,
  ))!.buffer.asUint8List();
  image.dispose();
  return bytes;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('full-size decode is pixel-exact where the scaling entry floors', () async {
    // 402x183 makes the engine's scaled-codec path floor the derived
    // axis to 182 even at scale 1.0; the full-size decode must not take
    // that path.
    const decoder = RitoUiImageDecoder();
    final source = await decoder.open(
      encodedBytes: await rasterPng(402, 183),
      mediaType: 'image/png',
    );
    expect((source.width, source.height), (402, 183));
    final image = await source.decode(targetWidth: 402, targetHeight: 183);
    expect((image.width, image.height), (402, 183));
    image.dispose();
    source.dispose();
  });

  test('scaled decode stays within its bounded target', () async {
    const decoder = RitoUiImageDecoder();
    final source = await decoder.open(
      encodedBytes: await rasterPng(402, 183),
      mediaType: 'image/png',
    );
    final image = await source.decode(targetWidth: 201, targetHeight: 92);
    expect(image.width, lessThanOrEqualTo(201));
    expect(image.height, lessThanOrEqualTo(92));
    image.dispose();
    source.dispose();
  });
}
