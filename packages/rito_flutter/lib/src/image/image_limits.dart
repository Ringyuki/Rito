/// Production safety limits for one artifact image preparation lease.
///
/// Defaults cap one encoded image at 16 MiB, all encoded reads for one lease
/// at 64 MiB, source images at 16,384 px / 64 megapixels, and decoded targets
/// at 16 megapixels (about 64 MiB for four-byte pixels). Applications may use
/// lower limits, or raise them deliberately for a known publication profile.
final class RitoArtifactImageLimits {
  const RitoArtifactImageLimits({
    this.maxEncodedBytesPerImage = 16 * 1024 * 1024,
    this.maxEncodedBytesPerLease = 64 * 1024 * 1024,
    this.maxSourceDimension = 16384,
    this.maxSourcePixels = 64 * 1024 * 1024,
    this.maxTargetPixelsPerLease = 16 * 1024 * 1024,
  });

  final int maxEncodedBytesPerImage;
  final int maxEncodedBytesPerLease;
  final int maxSourceDimension;
  final int maxSourcePixels;
  final int maxTargetPixelsPerLease;

  void validate() {
    if (maxEncodedBytesPerImage <= 0 ||
        maxEncodedBytesPerLease < maxEncodedBytesPerImage ||
        maxSourceDimension <= 0 ||
        maxSourcePixels <= 0 ||
        maxTargetPixelsPerLease <= 0) {
      throw ArgumentError('Image preparation limits must be positive.');
    }
  }
}

final class RitoImageBudgetExceededException implements Exception {
  const RitoImageBudgetExceededException(this.message);

  final String message;

  @override
  String toString() => 'RitoImageBudgetExceededException: $message';
}
