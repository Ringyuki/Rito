import 'dart:convert';
import 'dart:typed_data';

import 'binary_reader.dart';

RitoBinaryReader openRitoWireMessage(
  Uint8List bytes, {
  required String magic,
  required String label,
  int maxBytes = ritoMaxWireBytes,
  int? exactBytes,
}) {
  if (bytes.length > maxBytes) {
    throw FormatException('$magic exceeds the byte limit.');
  }
  if (exactBytes != null && bytes.length != exactBytes) {
    throw FormatException('$magic must be exactly $exactBytes bytes.');
  }
  final reader = RitoBinaryReader(bytes);
  reader.expectMagic(ascii.encode(magic), '$label magic');
  final version = reader.uint32('$label wire version');
  if (version != 1) {
    reader.fail('unsupported $label wire version: $version');
  }
  final declaredLength = reader.uint64('$label total length');
  if (declaredLength != bytes.length) {
    reader.fail('$label total length does not match input');
  }
  return reader;
}

final class RitoFixedMessageWriter {
  RitoFixedMessageWriter(String magic) {
    final encoded = ascii.encode(magic);
    if (encoded.length != 8) {
      throw ArgumentError.value(
        magic,
        'magic',
        'must contain eight ASCII bytes',
      );
    }
    _bytes.addAll(encoded);
    uint32(1, 'wire version');
    uint64(0, 'wire length');
  }

  final List<int> _bytes = <int>[];

  void externalId(int value, String field) {
    if (value <= 0 || value > 0x7fffffffffffffff) {
      throw FormatException('$field must be a non-zero external ID.');
    }
    uint64(value, field);
  }

  void fixedOptionalExternalId(int? value, String field) {
    if (value == null) {
      uint32(0, '$field option tag');
      uint64(0, '$field option value');
      return;
    }
    if (value <= 0 || value > 0x7fffffffffffffff) {
      throw FormatException('$field must be a non-zero external ID.');
    }
    uint32(1, '$field option tag');
    uint64(value, '$field option value');
  }

  void uint32(int value, String field) => _unsigned(value, 32, field);

  void uint64(int value, String field) => _unsigned(value, 64, field);

  Uint8List finish({required String magic, required int expectedBytes}) {
    if (_bytes.length != expectedBytes) {
      throw StateError('$magic must be exactly $expectedBytes bytes.');
    }
    _patchUint64(12, _bytes.length);
    return Uint8List.fromList(_bytes);
  }

  void _unsigned(int value, int bits, String field) {
    final exceedsWidth = bits == 32 && value > 0xffffffff;
    if (value < 0 || exceedsWidth) {
      throw FormatException('$field exceeds uint$bits.');
    }
    final data = ByteData(bits ~/ 8);
    if (bits == 32) {
      data.setUint32(0, value, Endian.little);
    } else {
      data.setUint64(0, value, Endian.little);
    }
    _bytes.addAll(data.buffer.asUint8List());
  }

  void _patchUint64(int offset, int value) {
    final data = ByteData(8)..setUint64(0, value, Endian.little);
    _bytes.setRange(offset, offset + 8, data.buffer.asUint8List());
  }
}
