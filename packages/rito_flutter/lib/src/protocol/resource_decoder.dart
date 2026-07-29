import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';

final class RitoResourceDecoder {
  const RitoResourceDecoder();

  static final List<int> _magic = ascii.encode('RITORES1');

  RitoResource decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITORES1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'resource magic');
    final version = reader.uint32('resource wire version');
    if (version != 1) {
      reader.fail('unsupported resource wire version: $version');
    }
    final declaredLength = reader.uint64('resource total length');
    if (declaredLength != bytes.length) {
      reader.fail('resource total length does not match input');
    }
    final artifactId = reader.externalId('resource artifact id');
    final kind = _kind(reader);
    final resource = RitoResource(
      artifactId: artifactId,
      kind: kind,
      href: reader.string('resource href'),
      mediaType: reader.string('resource media type'),
      // The returned view keeps the owned wire buffer alive and avoids one
      // full resource copy between FFI transfer and the platform decoder.
      bytes: reader.blobView('resource bytes', maxBytes: _byteLimit(kind)),
      width: reader.option('resource width', () => reader.uint32('width')),
      height: reader.option('resource height', () => reader.uint32('height')),
    );
    reader.finish('resource wire message');
    return resource;
  }

  RitoResourceKind _kind(RitoBinaryReader reader) {
    final value = reader.uint32('resource kind');
    return switch (value) {
      0 => RitoResourceKind.image,
      1 => RitoResourceKind.font,
      2 => RitoResourceKind.stylesheet,
      _ => reader.fail('unknown resource kind: $value'),
    };
  }

  int _byteLimit(RitoResourceKind kind) => switch (kind) {
    RitoResourceKind.image => 32 * 1024 * 1024,
    RitoResourceKind.font => 16 * 1024 * 1024,
    RitoResourceKind.stylesheet => 4 * 1024 * 1024,
  };
}
