import 'dart:convert';
import 'dart:typed_data';

import 'wire_exception.dart';

const int ritoMaxWireBytes = 256 * 1024 * 1024;
const int ritoMaxStringBytes = 16 * 1024 * 1024;
const int ritoMaxCollectionItems = 1000000;

final class RitoBinaryReader {
  RitoBinaryReader(Uint8List bytes, {int start = 0, int? end})
    : this._shared(bytes, ByteData.sublistView(bytes), start, end);

  RitoBinaryReader._shared(this._bytes, this._data, int start, int? end)
    : _start = start,
      _end = end ?? _bytes.length,
      _offset = start {
    if (start < 0 || _end < start || _end > _bytes.length) {
      throw ArgumentError('Invalid Rito binary reader range.');
    }
  }

  final Uint8List _bytes;

  /// One view over the whole message, which every record of it shares: a
  /// view per number read made decoding a display list allocate for every
  /// number in it.
  final ByteData _data;
  final int _start;
  final int _end;
  int _offset;

  int get offset => _offset - _start;
  int get remaining => _end - _offset;
  bool get isFinished => _offset == _end;

  RitoBinaryReader record(String field) {
    final length = uint64('$field length');
    if (length > ritoMaxWireBytes) {
      fail('$field exceeds the record byte limit');
    }
    final recordEnd = _checkedEnd(length, field);
    final reader = RitoBinaryReader._shared(_bytes, _data, _offset, recordEnd);
    _offset = recordEnd;
    return reader;
  }

  int count(String field) {
    final value = uint32(field);
    if (value > ritoMaxCollectionItems) {
      fail('$field exceeds the item limit');
    }
    return value;
  }

  String string(String field) {
    final length = uint32('$field length');
    if (length > ritoMaxStringBytes) {
      fail('$field exceeds the string byte limit');
    }
    final value = take(length, field);
    try {
      return utf8.decode(value, allowMalformed: false);
    } on FormatException {
      fail('$field is not valid UTF-8');
    }
  }

  Uint8List blob(String field, {int maxBytes = ritoMaxWireBytes}) {
    return Uint8List.fromList(blobView(field, maxBytes: maxBytes));
  }

  Uint8List blobView(String field, {int maxBytes = ritoMaxWireBytes}) {
    final length = uint64('$field length');
    if (length > maxBytes) {
      fail('$field exceeds its operation byte limit');
    }
    return take(length, field);
  }

  T? option<T>(String field, T Function() read) {
    final tag = uint8('$field option tag');
    return switch (tag) {
      0 => null,
      1 => read(),
      _ => fail('unknown $field option tag: $tag'),
    };
  }

  bool boolean(String field) {
    final tag = uint8('$field boolean tag');
    return switch (tag) {
      0 => false,
      1 => true,
      _ => fail('unknown $field boolean tag: $tag'),
    };
  }

  int uint8(String field) => _bytes[_advance(1, field)];

  int uint16(String field) =>
      _data.getUint16(_advance(2, field), Endian.little);

  int uint32(String field) =>
      _data.getUint32(_advance(4, field), Endian.little);

  int uint64(String field) =>
      _data.getUint64(_advance(8, field), Endian.little);

  int externalId(String field) {
    final value = uint64(field);
    if (value <= 0 || value > 0x7fffffffffffffff) {
      fail('$field must be a non-zero external ID');
    }
    return value;
  }

  int? fixedOptionalExternalId(String field) {
    final tag = uint32('$field option tag');
    final value = uint64('$field option value');
    return switch (tag) {
      0 when value == 0 => null,
      0 => fail('$field none tag must carry a zero payload'),
      1 when value > 0 && value <= 0x7fffffffffffffff => value,
      1 => fail('$field some tag must carry a valid external ID'),
      _ => fail('unknown $field option tag: $tag'),
    };
  }

  int int64(String field) => _data.getInt64(_advance(8, field), Endian.little);

  double float32(String field) {
    final value = _data.getFloat32(_advance(4, field), Endian.little);
    if (!value.isFinite) {
      fail('$field must be finite');
    }
    return value;
  }

  double float64(String field) {
    final value = _data.getFloat64(_advance(8, field), Endian.little);
    if (!value.isFinite) {
      fail('$field must be finite');
    }
    return value;
  }

  Uint8List take(int length, String field) {
    final next = _checkedEnd(length, field);
    final value = Uint8List.sublistView(_bytes, _offset, next);
    _offset = next;
    return value;
  }

  void expectMagic(List<int> expected, String field) {
    final actual = take(expected.length, field);
    for (var index = 0; index < expected.length; index += 1) {
      if (actual[index] != expected[index]) {
        fail('$field is invalid');
      }
    }
  }

  void finish(String field) {
    if (!isFinished) {
      fail('$field contains trailing bytes');
    }
  }

  Never fail(String message) {
    throw RitoWireException(message, offset);
  }

  /// Moves past [length] bytes and answers where they begin.
  int _advance(int length, String field) {
    final at = _offset;
    _offset = _checkedEnd(length, field);
    return at;
  }

  int _checkedEnd(int length, String field) {
    if (length < 0 || length > remaining) {
      fail('$field is truncated');
    }
    return _offset + length;
  }
}
