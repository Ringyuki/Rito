part of 'gateway.dart';

/// Loads content shards of a publication opened from shards (see
/// `rito-pack`). Called with the ids the engine named the first time a call
/// needed them; a thrown error fails only that call.
typedef RitoShardLoader =
    Future<List<RitoPublicationShard>> Function(List<int> shardIds);

/// One content shard as the host's server delivered it.
final class RitoPublicationShard {
  const RitoPublicationShard({required this.id, required this.bytes, this.key});

  final int id;
  final Uint8List bytes;

  /// The shard's own 32-byte key when the shards are encrypted.
  final Uint8List? key;
}

/// Gateways that can open a publication from its skeleton shard and supply
/// content shards whenever a call waits on them.
abstract interface class RitoShardedPublicationGateway {
  /// Opens from [skeletonBytes] and returns the initial artifact. Shards the
  /// initial request needs are loaded through [loadShards] before it is
  /// requested again, as are the shards any later call on this session
  /// needs.
  Future<RitoArtifact> openShards({
    required Uint8List skeletonBytes,
    Uint8List? skeletonKey,
    required RitoArtifactRequest request,
    required RitoPinnedFontPolicy pinnedFontPolicy,
    required RitoShardLoader loadShards,
  });
}

/// A call needs at most its chapter, then that chapter's images and the
/// publication's fonts; the bound only stops a loader that keeps returning
/// shards the engine still reports missing.
const int _maxShardRounds = 16;

extension _ShardSupply on RitoIsolateGateway {
  bool _awaitsShards(int sessionId, Object error) {
    return error is RitoNativeException &&
        error.status == ritoNativeStatusResourcePending &&
        error.pendingShards.isNotEmpty &&
        _shardLoaders.containsKey(sessionId);
  }

  /// Loads and supplies [shardIds]; calls waiting on the same shard share
  /// one load.
  Future<void> _supplyShards(int sessionId, List<int> shardIds) {
    return Future.wait(<Future<void>>[
      for (final shardId in shardIds)
        _supplying.putIfAbsent(
          (sessionId, shardId),
          // The callback must not return the removed future: whenComplete
          // would then wait on itself.
          () => _supplyShard(sessionId, shardId).whenComplete(() {
            _supplying.remove((sessionId, shardId));
          }),
        ),
    ]);
  }

  Future<void> _supplyShard(int sessionId, int shardId) async {
    final loader = _shardLoaders[sessionId];
    if (loader == null) {
      throw StateError('Session $sessionId was not opened from shards.');
    }
    final loaded = await loader(<int>[shardId]);
    final shard = loaded.where((entry) => entry.id == shardId).firstOrNull;
    if (shard == null) {
      throw ArgumentError('loadShards did not return shard $shardId.');
    }
    final worker = await _worker;
    final supplied = await worker.invoke<int>(
      _SupplyShardOperation(
        sessionId: sessionId,
        shardBytes: RitoOwnedByteTransfer.take(Uint8List.fromList(shard.bytes)),
        key: shard.key,
      ),
    );
    if (supplied != shardId) {
      throw ArgumentError(
        'The bytes loaded for shard $shardId are shard $supplied.',
      );
    }
  }

  /// Runs [attempt] again after supplying what it waited on. Only for calls
  /// that carry no request identity: the retry is the same call.
  Future<T> _withShards<T>(int sessionId, Future<T> Function() attempt) async {
    for (var round = 0; ; round += 1) {
      try {
        return await attempt();
      } on RitoNativeException catch (error) {
        if (!_awaitsShards(sessionId, error) || round >= _maxShardRounds) {
          rethrow;
        }
        await _supplyShards(sessionId, error.pendingShards);
      }
    }
  }

  /// Supplies what an exact seek waited on and asks again under a newer
  /// native request ID (the failed one was consumed), recording it on the
  /// intent so the session adopts the substituted ID.
  Future<Uint8List> _retryExactSeekWithShards({
    required _GatewayIntent intent,
    required RitoArtifactRequest request,
    required RitoNativeException pending,
  }) async {
    var error = pending;
    for (var round = 0; ; round += 1) {
      if (round >= _maxShardRounds) throw error;
      await _supplyShards(request.sessionId, error.pendingShards);
      if (!_isCurrent(intent)) throw _superseded(intent);
      intent.requestId = _nextNativeRequestId(intent);
      final worker = await _worker;
      try {
        return await worker.invokeWire(
          _RequestArtifactOperation(
            sessionId: request.sessionId,
            requestBytes: _requestEncoder.encode(
              request.withRequestId(intent.requestId),
            ),
          ),
        );
      } on RitoNativeException catch (next) {
        if (!_awaitsShards(request.sessionId, next)) rethrow;
        error = next;
      }
    }
  }

  int _nextNativeRequestId(_GatewayIntent intent) {
    if (intent.requestId >= 0x7fffffffffffffff) {
      throw StateError('Rito reader request ID space is exhausted.');
    }
    return intent.requestId + 1;
  }
}
