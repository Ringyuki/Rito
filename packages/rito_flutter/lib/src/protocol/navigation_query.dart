import 'dart:convert';
import 'dart:typed_data';

import 'artifact_models.dart';
import 'binary_reader.dart';

/// A reading-position question. The engine answers each the way it
/// answers a browser reader, so a chapter title, a bookmark check or a
/// turn direction is the same on every host.
sealed class RitoNavigationQuery {
  const RitoNavigationQuery();
}

/// The TOC entry a page of an artifact's revision reads under: the last
/// entry, in TOC order, whose target sits at or before the page.
final class RitoTocEntryAtPageQuery extends RitoNavigationQuery {
  const RitoTocEntryAtPageQuery({
    required this.artifactId,
    required this.pageIndex,
  });

  final int artifactId;
  final int pageIndex;
}

/// The TOC entry a source position reads under, decided on the source
/// alone — for naming the chapter of a stored highlight or bookmark.
final class RitoTocEntryAtPositionQuery extends RitoNavigationQuery {
  const RitoTocEntryAtPositionQuery({required this.href, required this.point});

  final String href;
  final RitoSourcePoint point;
}

/// Where a stored locator lands in an artifact's revision.
final class RitoLocateQuery extends RitoNavigationQuery {
  const RitoLocateQuery({required this.artifactId, required this.locator});

  final int artifactId;
  final RitoLocator locator;
}

/// The reading order of two source positions.
final class RitoCompareQuery extends RitoNavigationQuery {
  const RitoCompareQuery({
    required this.firstHref,
    required this.first,
    required this.secondHref,
    required this.second,
  });

  final String firstHref;
  final RitoSourcePoint first;
  final String secondHref;
  final RitoSourcePoint second;
}

final class RitoNavigationRequest {
  const RitoNavigationRequest({required this.sessionId, required this.query});

  final int sessionId;
  final RitoNavigationQuery query;
}

/// Where a stored locator landed.
sealed class RitoLocation {
  const RitoLocation();
}

/// On [pageIndex] of the revision; [drawn] says whether the asking
/// artifact draws that page.
final class RitoLocatedPage extends RitoLocation {
  const RitoLocatedPage({
    required this.pageIndex,
    required this.drawn,
    required this.matchedBy,
  });

  final int pageIndex;
  final bool drawn;
  final RitoLocatorMatch matchedBy;
}

/// The locator's chapter is not laid out in this revision.
final class RitoNotLaidOut extends RitoLocation {
  const RitoNotLaidOut();
}

/// The locator does not resolve in the publication.
final class RitoLocationUnavailable extends RitoLocation {
  const RitoLocationUnavailable();
}

sealed class RitoNavigationResult {
  const RitoNavigationResult();
}

/// A TOC entry by its preorder index — the `tocId` the publication
/// carries — or null when nothing precedes the page or position.
final class RitoTocEntryResult extends RitoNavigationResult {
  const RitoTocEntryResult(this.tocId);

  final int? tocId;
}

final class RitoLocationResult extends RitoNavigationResult {
  const RitoLocationResult(this.location);

  final RitoLocation location;
}

/// -1, 0 or 1 as the first position reads before, at or after the second.
final class RitoOrderResult extends RitoNavigationResult {
  const RitoOrderResult(this.order);

  final int order;
}

/// Decodes a RITONVR1 message.
final class RitoNavigationDecoder {
  const RitoNavigationDecoder();

  static final List<int> _magic = ascii.encode('RITONVR1');

  RitoNavigationResult decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITONVR1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'navigation magic');
    final version = reader.uint32('navigation wire version');
    if (version != 1) {
      reader.fail('unsupported navigation wire version: $version');
    }
    if (reader.uint64('navigation total length') != bytes.length) {
      reader.fail('navigation total length does not match input');
    }
    final tag = reader.uint8('navigation result tag');
    final RitoNavigationResult result = switch (tag) {
      0 => RitoTocEntryResult(
        reader.option('toc entry', () => reader.uint32('toc entry')),
      ),
      1 => RitoLocationResult(_location(reader)),
      2 => RitoOrderResult(_order(reader)),
      _ => reader.fail('unknown navigation result tag: $tag'),
    };
    reader.finish('navigation wire message');
    return result;
  }

  RitoLocation _location(RitoBinaryReader reader) {
    final tag = reader.uint8('location tag');
    switch (tag) {
      case 0:
        final pageIndex = reader.uint32('located page');
        final drawn = reader.boolean('page drawn');
        final match = reader.uint8('locator match');
        if (match >= RitoLocatorMatch.values.length) {
          reader.fail('unknown locator match: $match');
        }
        return RitoLocatedPage(
          pageIndex: pageIndex,
          drawn: drawn,
          matchedBy: RitoLocatorMatch.values[match],
        );
      case 1:
        return const RitoNotLaidOut();
      case 2:
        return const RitoLocationUnavailable();
      default:
        reader.fail('unknown location tag: $tag');
    }
  }

  int _order(RitoBinaryReader reader) {
    final tag = reader.uint8('order');
    return switch (tag) {
      0 => -1,
      1 => 0,
      2 => 1,
      _ => reader.fail('unknown order tag: $tag'),
    };
  }
}
