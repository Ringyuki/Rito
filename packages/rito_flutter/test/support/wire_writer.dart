import 'dart:convert';
import 'dart:typed_data';

final class TestWireWriter {
  TestWireWriter.message(String magic) {
    bytes.addAll(ascii.encode(magic));
    uint32(1);
    uint64(0);
  }

  TestWireWriter.raw();

  final List<int> bytes = <int>[];

  Uint8List finishMessage() {
    patchUint64(12, bytes.length);
    return Uint8List.fromList(bytes);
  }

  void record(void Function(TestWireWriter writer) body) {
    final lengthOffset = bytes.length;
    uint64(0);
    final start = bytes.length;
    body(this);
    patchUint64(lengthOffset, bytes.length - start);
  }

  void option(void Function()? body) {
    uint8(body == null ? 0 : 1);
    body?.call();
  }

  void fixedExternalIdOption(int? value) {
    uint32(value == null ? 0 : 1);
    uint64(value ?? 0);
  }

  void string(String value) {
    final encoded = utf8.encode(value);
    uint32(encoded.length);
    bytes.addAll(encoded);
  }

  void blob(List<int> value) {
    uint64(value.length);
    bytes.addAll(value);
  }

  void fixed(List<int> value) {
    uint32(value.length);
    bytes.addAll(value);
  }

  void boolean(bool value) => uint8(value ? 1 : 0);

  void uint8(int value) => bytes.add(value);

  void uint16(int value) =>
      _data(2, (data) => data.setUint16(0, value, Endian.little));

  void uint32(int value) =>
      _data(4, (data) => data.setUint32(0, value, Endian.little));

  void uint64(int value) =>
      _data(8, (data) => data.setUint64(0, value, Endian.little));

  void float32(double value) {
    _data(4, (data) => data.setFloat32(0, value, Endian.little));
  }

  void float64(double value) {
    _data(8, (data) => data.setFloat64(0, value, Endian.little));
  }

  void patchUint64(int offset, int value) {
    final data = ByteData(8)..setUint64(0, value, Endian.little);
    bytes.setRange(offset, offset + 8, data.buffer.asUint8List());
  }

  void _data(int length, void Function(ByteData data) write) {
    final data = ByteData(length);
    write(data);
    bytes.addAll(data.buffer.asUint8List());
  }
}
