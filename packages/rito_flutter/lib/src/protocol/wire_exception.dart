final class RitoWireException implements FormatException {
  const RitoWireException(this.message, [this.offset]);

  @override
  final String message;

  @override
  final int? offset;

  @override
  Object? get source => null;

  @override
  String toString() {
    final position = offset == null ? '' : ' at byte $offset';
    return 'RitoWireException$position: $message';
  }
}
