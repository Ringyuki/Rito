import 'dart:isolate';
import 'dart:typed_data';

/// Single-owner byte transport for the native worker boundary.
///
/// The sender creates a transferable backing store and never materializes it.
/// The receiving isolate materializes it exactly once; the Dart runtime rejects
/// every later materialization attempt.
final class RitoOwnedByteTransfer {
  const RitoOwnedByteTransfer._();

  static TransferableTypedData take(Uint8List bytes) {
    return TransferableTypedData.fromList(<TypedData>[bytes]);
  }

  static Uint8List materialize(TransferableTypedData transfer) {
    return transfer.materialize().asUint8List();
  }
}
