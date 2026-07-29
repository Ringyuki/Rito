import 'dart:typed_data';

import 'binary_reader.dart';
import 'locator_reader.dart';
import 'publication_models.dart';
import 'wire_message.dart';

part 'publication_decoder_toc.dart';

const int ritoPublicationMaxWireBytes = 16 * 1024 * 1024;
const int ritoPublicationMaxTocDepth = 64;
const int ritoPublicationMaxTocItems = 100000;

final class RitoPublicationDecoder {
  const RitoPublicationDecoder();

  RitoPublication decode(Uint8List bytes) {
    final reader = openRitoWireMessage(
      bytes,
      magic: 'RITOPUB1',
      label: 'publication',
      maxBytes: ritoPublicationMaxWireBytes,
    );
    final protocolVersion = reader.uint32('publication protocol version');
    if (protocolVersion != 1) {
      reader.fail('unsupported publication protocol version: $protocolVersion');
    }
    final sessionId = reader.externalId('publication session id');
    final metadata = _metadata(reader);
    final spineCount = reader.count('publication spine');
    final spine = <RitoPublicationSpineItem>[
      for (var index = 0; index < spineCount; index += 1) _spineItem(reader),
    ];
    final duplicateHrefs = _validateSpine(reader, spine);
    final toc = _tocEntries(
      reader,
      1,
      _PublicationDecodeState(spine, duplicateHrefs),
    );
    reader.finish('publication wire message');
    return RitoPublication(
      protocolVersion: protocolVersion,
      sessionId: sessionId,
      metadata: metadata,
      spine: spine,
      toc: toc,
    );
  }

  RitoPublicationMetadata _metadata(RitoBinaryReader reader) {
    final record = reader.record('publication metadata');
    final metadata = RitoPublicationMetadata(
      title: record.string('publication title'),
      language: record.string('publication language'),
      identifier: record.string('publication identifier'),
      creator: record.option(
        'publication creator',
        () => record.string('publication creator'),
      ),
    );
    record.finish('publication metadata');
    return metadata;
  }

  RitoPublicationSpineItem _spineItem(RitoBinaryReader reader) {
    final record = reader.record('publication spine item');
    final item = RitoPublicationSpineItem(
      spineIndex: record.uint32('publication spine index'),
      linearIndex: record.option(
        'publication linear index',
        () => record.uint32('publication linear index'),
      ),
      idref: record.string('publication spine idref'),
      href: record.string('publication spine href'),
    );
    record.finish('publication spine item');
    return item;
  }

  Set<String> _validateSpine(
    RitoBinaryReader reader,
    List<RitoPublicationSpineItem> spine,
  ) {
    var nextLinearIndex = 0;
    final hrefs = <String>{};
    final duplicateHrefs = <String>{};
    for (var index = 0; index < spine.length; index += 1) {
      final item = spine[index];
      if (item.spineIndex != index) {
        reader.fail('publication spine indexes must be dense and ordered');
      }
      if (item.idref.isEmpty || item.href.isEmpty) {
        reader.fail('publication spine idref and href must not be empty');
      }
      if (!hrefs.add(item.href)) {
        duplicateHrefs.add(item.href);
      }
      final linearIndex = item.linearIndex;
      if (linearIndex != null) {
        if (linearIndex != nextLinearIndex) {
          reader.fail('publication linear indexes must be dense and ordered');
        }
        nextLinearIndex += 1;
      }
    }
    return duplicateHrefs;
  }
}

final class _PublicationDecodeState {
  _PublicationDecodeState(this.spine, this.duplicateHrefs);

  final List<RitoPublicationSpineItem> spine;
  final Set<String> duplicateHrefs;
  int itemCount = 0;
  int nextTocId = 0;
}

bool _isExternalHref(String href) {
  if (href.startsWith('//')) {
    return true;
  }
  var pathEnd = href.length;
  final query = href.indexOf('?');
  final fragment = href.indexOf('#');
  if (query >= 0 && query < pathEnd) {
    pathEnd = query;
  }
  if (fragment >= 0 && fragment < pathEnd) {
    pathEnd = fragment;
  }
  final path = href.substring(0, pathEnd);
  final colon = path.indexOf(':');
  if (colon <= 0) {
    return false;
  }
  for (var index = 0; index < colon; index += 1) {
    final code = path.codeUnitAt(index);
    final alphabetic =
        (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
    final allowedAfterFirst =
        index > 0 &&
        ((code >= 0x30 && code <= 0x39) ||
            code == 0x2b ||
            code == 0x2d ||
            code == 0x2e);
    if (!alphabetic && !allowedAfterFirst) {
      return false;
    }
  }
  return true;
}
