/// Raised when the native worker terminated before acknowledging an
/// operation. The engine runs on the calling isolate now and nothing
/// raises it.
@Deprecated('The engine no longer runs on a worker isolate; nothing raises it.')
final class RitoNativeWorkerTerminatedException implements Exception {
  const RitoNativeWorkerTerminatedException({
    required this.message,
    this.remoteError,
  });

  final String message;
  final String? remoteError;

  @override
  String toString() {
    final detail = remoteError;
    return detail == null
        ? 'RitoNativeWorkerTerminatedException: $message'
        : 'RitoNativeWorkerTerminatedException: $message ($detail)';
  }
}
