import 'dart:typed_data';

import 'wire_message.dart';

/// `RITOPSH1`: what a call that returned the resource-pending status waited
/// on. A publication opened from shards names, in ascending order, the
/// content shards to supply before the call is retried.
final class RitoPendingShards {
  const RitoPendingShards({required this.shardIds, required this.message});

  final List<int> shardIds;
  final String message;
}

final class RitoPendingShardsDecoder {
  const RitoPendingShardsDecoder();

  RitoPendingShards decode(Uint8List bytes) {
    final reader = openRitoWireMessage(
      bytes,
      magic: 'RITOPSH1',
      label: 'pending shards',
    );
    final count = reader.count('pending shards');
    if (count == 0) reader.fail('a pending failure names at least one shard');
    final shardIds = <int>[];
    for (var index = 0; index < count; index += 1) {
      final shardId = reader.uint32('pending shard id');
      if (shardId == 0)
        reader.fail('shard 0 is the skeleton and is never pending');
      if (shardIds.isNotEmpty && shardId <= shardIds.last) {
        reader.fail('pending shards are ascending and distinct');
      }
      shardIds.add(shardId);
    }
    final message = reader.string('pending shards message');
    reader.finish('pending shards wire message');
    return RitoPendingShards(
      shardIds: List<int>.unmodifiable(shardIds),
      message: message,
    );
  }
}
