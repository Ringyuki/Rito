import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

// 8x4 stored JPEG scan with an EXIF orientation-8 APP1 (LeftBottom):
// browsers and the Rust engine present it as 4x8.
const String exif8JpegBase64 =
    '/9j/4QAiRXhpZgAASUkqAAgAAAABABIBAwABAAAACAAAAAAAAAD/4AAQSkZJRgABAQAAAQABAAD/'
    '2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ'
    'CgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ'
    'EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAEAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAA'
    'AAAAAAAACP/EABoQAAAHAAAAAAAAAAAAAAAAAAABBhZUodH/xAAVAQEBAAAAAAAAAAAAAAAAAAAG'
    'CP/EABsRAAEEAwAAAAAAAAAAAAAAAAAGF1SxGNHS/9oADAMBAAIRAxEAPwALvpRzKPRcWOqAiVyK'
    '34W8q9n/2Q==';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('an EXIF quarter-turned JPEG decodes to its presented dimensions', () async {
    // The Rust engine declares the PRESENTED dimensions for orientation
    // 5-8 JPEGs (stored width/height swapped). The artifact image cache
    // paints the decoded ui.Image into layout boxes sized from that
    // declaration, without any rotation step of its own — which is only
    // correct if dart:ui applies the EXIF orientation during decode.
    // This pins that contract on the reference engine: the descriptor
    // reports oriented dimensions and the decoded raster is oriented.
    final bytes = Uint8List.fromList(base64Decode(exif8JpegBase64));
    const decoder = RitoUiImageDecoder();
    final source = await decoder.open(
      encodedBytes: bytes,
      mediaType: 'image/jpeg',
    );
    expect((source.width, source.height), (4, 8));
    final ui.Image image = await source.decode(targetWidth: 4, targetHeight: 8);
    expect((image.width, image.height), (4, 8));
    image.dispose();
    source.dispose();
  });
}
