import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';
import 'display_decoder.dart';

part 'artifact_decoder_fields.dart';
part 'artifact_decoder_pages.dart';

final class RitoArtifactDecoder {
  const RitoArtifactDecoder({
    this.displayListDecoder = const RitoDisplayListDecoder(),
  });

  static const int protocolVersion = 1;
  static const int wireVersion = 1;
  static const int _maxSemanticDepth = 64;
  static final List<int> _magic = ascii.encode('RITOART1');

  final RitoDisplayListDecoder displayListDecoder;

  RitoArtifact decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOART1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'artifact magic');
    final version = reader.uint32('artifact wire version');
    if (version != wireVersion) {
      reader.fail('unsupported artifact wire version: $version');
    }
    final declaredLength = reader.uint64('artifact total length');
    if (declaredLength != bytes.length) {
      reader.fail('artifact total length does not match input');
    }
    final artifact = _artifact(reader);
    reader.finish('artifact wire message');
    return artifact;
  }

  RitoArtifact _artifact(RitoBinaryReader reader) {
    final protocol = reader.uint32('artifact protocol version');
    if (protocol != protocolVersion) {
      reader.fail('unsupported artifact protocol version: $protocol');
    }
    final capabilityProfile = reader.uint32('capability profile');
    if (capabilityProfile != 1) {
      reader.fail('unsupported capability profile: $capabilityProfile');
    }
    return RitoArtifact(
      protocolVersion: protocol,
      capabilityProfileId: capabilityProfile,
      sessionId: reader.externalId('session id'),
      requestId: reader.externalId('request id'),
      revisionId: reader.externalId('revision id'),
      revisionVersion: reader.uint32('revision version'),
      artifactId: reader.externalId('artifact id'),
      locator: _locator(reader),
      matchedBy: _locatorMatch(reader),
      localPageIndex: reader.uint32('local page index'),
      localSpreadIndex: reader.uint32('local spread index'),
      localPageIndexes: _uint32Collection(reader, 'local page indexes'),
      width: reader.float64('artifact width'),
      height: reader.float64('artifact height'),
      terminalExtent: reader.boolean('terminal extent'),
      navigation: RitoNavigation(
        previous: _adjacentAvailability(reader),
        next: _adjacentAvailability(reader),
      ),
      textProfile: _textProfile(reader),
      displayList: _displayList(reader),
      resources: _resources(reader),
      fonts: _fonts(reader),
      pages: _pages(reader),
    );
  }

  List<int> _uint32Collection(RitoBinaryReader reader, String field) {
    final count = reader.count(field);
    return [
      for (var index = 0; index < count; index += 1) reader.uint32(field),
    ];
  }
}
