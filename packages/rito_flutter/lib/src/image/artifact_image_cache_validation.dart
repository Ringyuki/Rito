part of 'artifact_image_cache.dart';

extension _ImageCacheValidation on RitoArtifactImageCache {
  Map<String, RitoResourceRef> _imageDeclarations(RitoArtifact artifact) {
    final declarations = <String, RitoResourceRef>{};
    for (final reference in artifact.resources) {
      if (reference.kind != RitoResourceKind.image) {
        continue;
      }
      if (reference.href.isEmpty || declarations.containsKey(reference.href)) {
        throw const FormatException(
          'Artifact contains an invalid or duplicate image declaration.',
        );
      }
      declarations[reference.href] = reference;
    }
    return declarations;
  }

  void _validateResourceIdentity(
    RitoArtifact artifact,
    RitoResourceRef reference,
    RitoResource resource,
  ) {
    if (resource.artifactId != artifact.artifactId ||
        resource.kind != RitoResourceKind.image ||
        resource.href != reference.href) {
      throw StateError('Image resource ownership does not match its artifact.');
    }
    if (resource.bytes.isEmpty ||
        resource.bytes.length > limits.maxEncodedBytesPerImage) {
      throw RitoImageBudgetExceededException(
        'Encoded image ${reference.href} exceeds the per-image byte limit.',
      );
    }
    if (resource.mediaType.isEmpty) {
      throw FormatException('Image ${reference.href} has no media type.');
    }
  }

  void _validateSource(
    RitoResource resource,
    RitoImageDecodeSource source,
    _ImageEntry? expected,
  ) {
    final width = source.width;
    final height = source.height;
    if (width <= 0 ||
        height <= 0 ||
        width > limits.maxSourceDimension ||
        height > limits.maxSourceDimension ||
        width * height > limits.maxSourcePixels) {
      throw RitoImageBudgetExceededException(
        'Image ${resource.href} exceeds the source dimension budget.',
      );
    }
    final declaredWidth = resource.width;
    final declaredHeight = resource.height;
    if ((declaredWidth == null) != (declaredHeight == null) ||
        (declaredWidth != null &&
            (declaredWidth != width || declaredHeight != height))) {
      throw FormatException(
        'Image ${resource.href} dimensions do not match its resource header.',
      );
    }
    if (expected != null &&
        (expected.sourceWidth != width || expected.sourceHeight != height)) {
      throw StateError('Immutable image dimensions changed within a session.');
    }
  }

  void _validateDecoded(
    ui.Image image,
    RitoImageDecodeSource source,
    _ImageDecodeDimensions target,
    String href,
  ) {
    final aspectError =
        (image.width * source.height - image.height * source.width).abs();
    final roundingTolerance = math.max(source.width, source.height);
    final requiresSourceDimensions =
        target.width == source.width && target.height == source.height;
    if (image.width <= 0 ||
        image.height <= 0 ||
        image.width > target.width ||
        image.height > target.height ||
        (requiresSourceDimensions &&
            (image.width != source.width || image.height != source.height)) ||
        image.width > source.width ||
        image.height > source.height ||
        aspectError > roundingTolerance) {
      throw FormatException(
        'Decoded image $href violates its bounded aspect-preserving target.',
      );
    }
  }

  _ImageEntry? _knownEntry(_SourceKey key) {
    for (final entry in _entries.values) {
      if (entry.key.sessionId == key.sessionId && entry.key.href == key.href) {
        return entry;
      }
    }
    return null;
  }

  _CacheKey _cacheKey(_SourceKey source, _ImageDecodeDimensions target) => (
    sessionId: source.sessionId,
    href: source.href,
    targetWidth: target.width,
    targetHeight: target.height,
  );
}
