import 'artifact_models.dart';

final class RitoPublicationMetadata {
  const RitoPublicationMetadata({
    required this.title,
    required this.language,
    required this.identifier,
    this.creator,
  });

  final String title;
  final String language;
  final String identifier;
  final String? creator;
}

final class RitoPublicationSpineItem {
  const RitoPublicationSpineItem({
    required this.spineIndex,
    required this.idref,
    required this.href,
    this.linearIndex,
  });

  final int spineIndex;
  final int? linearIndex;
  final String idref;
  final String href;
}

sealed class RitoPublicationTocTarget {
  const RitoPublicationTocTarget();
}

final class RitoPublicationTocLocatorTarget
    extends RitoPublicationTocTarget {
  const RitoPublicationTocLocatorTarget({
    required this.spineIndex,
    required this.locator,
  });

  final int spineIndex;
  final RitoLocator locator;
}

final class RitoPublicationTocExternalTarget
    extends RitoPublicationTocTarget {
  const RitoPublicationTocExternalTarget({required this.href});

  final String href;
}

final class RitoPublicationTocUnresolvedTarget
    extends RitoPublicationTocTarget {
  const RitoPublicationTocUnresolvedTarget({required this.href});

  final String href;
}

final class RitoPublicationTocEntry {
  RitoPublicationTocEntry({
    required this.tocId,
    required this.label,
    required this.target,
    required List<RitoPublicationTocEntry> children,
  }) : children = List<RitoPublicationTocEntry>.unmodifiable(children);

  final int tocId;
  final String label;
  final RitoPublicationTocTarget target;
  final List<RitoPublicationTocEntry> children;
}

final class RitoPublication {
  RitoPublication({
    required this.protocolVersion,
    required this.sessionId,
    required this.metadata,
    required List<RitoPublicationSpineItem> spine,
    required List<RitoPublicationTocEntry> toc,
  }) : spine = List<RitoPublicationSpineItem>.unmodifiable(spine),
       toc = List<RitoPublicationTocEntry>.unmodifiable(toc);

  final int protocolVersion;
  final int sessionId;
  final RitoPublicationMetadata metadata;
  final List<RitoPublicationSpineItem> spine;
  final List<RitoPublicationTocEntry> toc;
}
