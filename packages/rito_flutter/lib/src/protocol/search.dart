import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';
import 'locator_reader.dart';
import 'text_geometry.dart';

/// One in-book search hit.
final class RitoSearchResult {
  const RitoSearchResult({
    required this.pageIndex,
    required this.spreadIndex,
    required this.start,
    required this.end,
    required this.context,
    this.locator,
  });

  final int pageIndex;
  final int spreadIndex;

  /// Where the match sits in the page's laid-out text — pass these
  /// straight to [RitoReaderSession.textRangeGeometry] to paint it.
  final RitoTextPosition start;
  final RitoTextPosition end;

  /// Surrounding text for a result list.
  final String context;

  /// Durable source anchor. Store this rather than [pageIndex]: page
  /// numbers move when the book reflows, source anchors do not. Null
  /// when the layout kept no source identity for the match.
  final RitoLocator? locator;
}

final class RitoSearchResponse {
  RitoSearchResponse({
    required this.artifactId,
    required this.query,
    required this.truncated,
    required List<RitoSearchResult> results,
  }) : results = List<RitoSearchResult>.unmodifiable(results);

  final int artifactId;
  final String query;

  /// True when the hit list stopped at the requested limit, so it is a
  /// prefix rather than every match in scope.
  final bool truncated;
  final List<RitoSearchResult> results;
}

final class RitoSearchRequest {
  const RitoSearchRequest({
    required this.sessionId,
    required this.artifactId,
    required this.query,
    this.caseSensitive = false,
    this.wholeWord = false,
    this.limit = 0,
  });

  final int sessionId;
  final int artifactId;
  final String query;
  final bool caseSensitive;
  final bool wholeWord;

  /// Zero means unbounded, which over a whole book can be a long list.
  final int limit;
}

final class RitoSearchDecoder {
  const RitoSearchDecoder();

  static final List<int> _magic = ascii.encode('RITOSRS1');

  RitoSearchResponse decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITOSRS1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'search response magic');
    final version = reader.uint32('search response wire version');
    if (version != 1) {
      reader.fail('unsupported search response wire version: $version');
    }
    final declaredLength = reader.uint64('search response total length');
    if (declaredLength != bytes.length) {
      reader.fail('search response total length does not match input');
    }
    final artifactId = reader.externalId('search response artifact id');
    final query = reader.string('search query');
    final truncated = reader.boolean('search truncated');
    final count = reader.count('search results');
    final results = <RitoSearchResult>[
      for (var index = 0; index < count; index += 1) _result(reader),
    ];
    final response = RitoSearchResponse(
      artifactId: artifactId,
      query: query,
      truncated: truncated,
      results: results,
    );
    reader.finish('search response wire message');
    return response;
  }

  RitoSearchResult _result(RitoBinaryReader reader) {
    final record = reader.record('search result');
    final result = RitoSearchResult(
      pageIndex: record.uint32('search page index'),
      spreadIndex: record.uint32('search spread index'),
      start: _position(record, 'start'),
      end: _position(record, 'end'),
      context: record.string('search context'),
      locator: record.option(
        'search locator',
        () => readRitoLocator(record),
      ),
    );
    record.finish('search result');
    return result;
  }

  RitoTextPosition _position(RitoBinaryReader reader, String field) {
    return RitoTextPosition(
      blockIndex: reader.uint32('$field block index'),
      lineIndex: reader.uint32('$field line index'),
      runIndex: reader.uint32('$field run index'),
      charIndex: reader.uint32('$field char index'),
    );
  }
}
