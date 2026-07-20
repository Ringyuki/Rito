import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';
import 'request_models.dart';

final class RitoRequestEncoder {
  const RitoRequestEncoder();

  Uint8List encode(RitoArtifactRequest request) {
    final writer = _Writer.message(ascii.encode('RITOREQ1'), 1);
    writer.externalId(request.sessionId, 'session id');
    writer.externalId(request.requestId, 'request id');
    writer.record((writer) => _layout(writer, request.layout));
    writer.record((writer) => _locator(writer, request.locator));
    writer.record((writer) => _work(writer, request.work));
    writer.uint32(_textProfileTag(request.textProfile), 'text profile');
    return writer.finish();
  }

  Uint8List encodeAdjacent(RitoAdjacentRequest request) {
    final writer = _Writer.message(ascii.encode('RITONAV1'), 1);
    writer.externalId(request.sessionId, 'session id');
    writer.externalId(request.requestId, 'request id');
    writer.externalId(request.fromArtifactId, 'from artifact id');
    writer.uint32(
      request.direction == RitoAdjacentDirection.previous ? 0 : 1,
      'adjacent direction',
    );
    writer.uint32(
      request.work.maxTopLevelNodesPerQuantum,
      'max top-level nodes per quantum',
    );
    writer.uint32(request.work.maxForegroundQuanta, 'max foreground quanta');
    writer.uint32(request.work.localPageCap, 'local page cap');
    final bytes = writer.finish();
    if (bytes.length != 60) {
      throw StateError('RITONAV1 must be exactly 60 bytes.');
    }
    return bytes;
  }

  void _layout(_Writer writer, RitoLayoutRequest value) {
    writer.float64(value.viewportWidth, 'viewport width');
    writer.float64(value.viewportHeight, 'viewport height');
    writer.float64(value.marginTop, 'top margin');
    writer.float64(value.marginRight, 'right margin');
    writer.float64(value.marginBottom, 'bottom margin');
    writer.float64(value.marginLeft, 'left margin');
    writer.uint32(_spreadModeTag(value.spreadMode), 'spread mode');
    writer.boolean(value.firstPageAlone);
    writer.float64(value.spreadGap, 'spread gap');
    writer.float64(value.rootFontSize, 'root font size');
    writer.option(value.lineHeightOverride, (value) {
      writer.float64(value, 'line height override');
    });
    writer.option(value.fontFamilyOverride, (value) {
      writer.string(value, 'font family override');
    });
  }

  void _locator(_Writer writer, RitoLocator value) {
    writer.string(value.href, 'locator href');
    writer.option(value.anchorId, (value) => writer.string(value, 'anchor'));
    writer.option(
      value.sourcePoint,
      (value) => _sourcePointRecord(writer, value),
    );
    writer.option(value.sourceRange, (value) {
      writer.record((writer) {
        _sourcePointRecord(writer, value.start);
        _sourcePointRecord(writer, value.end);
      });
    });
    writer.option(value.progression, (value) {
      writer.float64(value, 'locator progression');
    });
  }

  void _sourcePointRecord(_Writer writer, RitoSourcePoint value) {
    writer.record((writer) {
      writer.count(value.nodePath.length, 'source path count');
      for (final part in value.nodePath) {
        writer.uint32(part, 'source path part');
      }
      writer.uint64(value.textOffset, 'source text offset');
    });
  }

  void _work(_Writer writer, RitoWorkBudget value) {
    writer.uint32(
      value.maxTopLevelNodesPerQuantum,
      'max top-level nodes per quantum',
    );
    writer.uint32(value.maxForegroundQuanta, 'max foreground quanta');
    writer.uint32(value.localPageCap, 'local page cap');
  }

  int _spreadModeTag(RitoSpreadMode value) {
    return switch (value) {
      RitoSpreadMode.single => 0,
      RitoSpreadMode.double => 1,
    };
  }

  int _textProfileTag(RitoTextProfile value) {
    return switch (value) {
      RitoTextProfile.platformStringRuns => 0,
      RitoTextProfile.positionedGlyphRuns => 1,
    };
  }
}

final class _Writer {
  _Writer._(this._bytes);

  factory _Writer.message(List<int> magic, int version) {
    final writer = _Writer._(<int>[]);
    writer._bytes.addAll(magic);
    writer.uint32(version, 'wire version');
    writer.uint64(0, 'wire length');
    return writer;
  }

  final List<int> _bytes;

  Uint8List finish() {
    if (_bytes.length > ritoMaxWireBytes) {
      throw const FormatException('Reader request exceeds the byte limit.');
    }
    _patchUint64(12, _bytes.length);
    return Uint8List.fromList(_bytes);
  }

  void record(void Function(_Writer writer) write) {
    final lengthOffset = _bytes.length;
    uint64(0, 'record length');
    final start = _bytes.length;
    write(this);
    _patchUint64(lengthOffset, _bytes.length - start);
  }

  void count(int value, String field) {
    if (value < 0 || value > ritoMaxCollectionItems) {
      throw FormatException('$field exceeds protocol limits.');
    }
    uint32(value, field);
  }

  void string(String value, String field) {
    final bytes = utf8.encode(value);
    if (bytes.length > ritoMaxStringBytes) {
      throw FormatException('$field exceeds protocol limits.');
    }
    uint32(bytes.length, '$field length');
    _bytes.addAll(bytes);
  }

  void option<T>(T? value, void Function(T value) write) {
    _bytes.add(value == null ? 0 : 1);
    if (value != null) {
      write(value);
    }
  }

  void boolean(bool value) => _bytes.add(value ? 1 : 0);

  void uint32(int value, String field) {
    _unsigned(value, 32, field);
  }

  void uint64(int value, String field) {
    _unsigned(value, 64, field);
  }

  void externalId(int value, String field) {
    if (value <= 0 || value > 0x7fffffffffffffff) {
      throw FormatException('$field must be a non-zero external ID.');
    }
    uint64(value, field);
  }

  void float64(double value, String field) {
    if (!value.isFinite) {
      throw FormatException('$field must be finite.');
    }
    final data = ByteData(8)..setFloat64(0, value, Endian.little);
    _bytes.addAll(data.buffer.asUint8List());
  }

  void _unsigned(int value, int bits, String field) {
    // Native Dart integers cannot represent a positive value above i64::MAX.
    // ByteData still writes those supported non-negative values into the full
    // uint64 field; IDs outside Dart's range must never be rounded or wrapped.
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
