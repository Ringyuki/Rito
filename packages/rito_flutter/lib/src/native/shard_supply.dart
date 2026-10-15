part of 'gateway.dart';

/// Loads content shards of a publication opened from shards (see
/// `@ritojs/pack`). Called with the ids the engine named the first time a call
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
  /// Opens from [skeletonBytes] and returns the initial artifact. Layout
  /// never waits on a content shard (the skeleton carries every chapter,
  /// stylesheet, font and image size); the image shards a resource read
  /// needs are loaded through [loadShards] and the read is retried.
  Future<RitoArtifact> openShards({
    required Uint8List skeletonBytes,
    Uint8List? skeletonKey,
    required RitoArtifactRequest request,
    required RitoPinnedFontPolicy pinnedFontPolicy,
    required RitoShardLoader loadShards,
  });
}

/// Supplies a sharded session's image shards ahead of need, so an image is
/// in the engine before a page draws it. It supplies one shard at a time and
/// only while the native worker is idle, so a page turn or a read waits
/// behind at most the one supply already under way. A shard it fails to
/// supply is left for the read that needs it, which loads it again and
/// reports the failure; the next restart offers it once more.
final class _ShardPrefetchLane {
  _ShardPrefetchLane(this._supply, this._whenIdle);

  final Future<void> Function(int shardId) _supply;
  final Future<void> Function() _whenIdle;
  final Set<int> _supplied = <int>{};
  List<int> _queue = <int>[];
  bool _running = false;
  bool _stopped = false;

  /// The chapter the queue is ordered from.
  String? near;

  bool get stopped => _stopped;

  /// Replaces the queue with [order], nearest first.
  void restart(List<int> order) {
    _queue = <int>[
      for (final shardId in order)
        if (!_supplied.contains(shardId)) shardId,
    ];
    unawaited(_pump());
  }

  /// Records a shard a read supplied, so the lane does not supply it again.
  void noteSupplied(int shardId) => _supplied.add(shardId);

  void stop() {
    _stopped = true;
    _queue = <int>[];
  }

  Future<void> _pump() async {
    if (_running) {
      return;
    }
    _running = true;
    try {
      while (!_stopped && _queue.isNotEmpty) {
        await _whenIdle();
        if (_stopped || _queue.isEmpty) {
          break;
        }
        final shardId = _queue.removeAt(0);
        if (!_supplied.add(shardId)) {
          continue;
        }
        try {
          await _supply(shardId);
        } on Object {
          _supplied.remove(shardId);
        }
      }
    } finally {
      _running = false;
    }
  }
}

/// A read waits on the shards of the images it names; the bound only stops
/// a loader that keeps returning shards the engine still reports missing.
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
    _prefetchLanes[sessionId]?.noteSupplied(shardId);
  }

  /// Moves where [sessionId]'s image shards are supplied ahead of need
  /// from: the chapter at [href]. A no-op for a session opened from an
  /// archive, or when the queue is already ordered from that chapter.
  void _prefetchNear(int sessionId, String href) {
    final lane = _prefetchLanes[sessionId];
    if (lane == null || lane.near == href) {
      return;
    }
    lane.near = href;
    unawaited(() async {
      try {
        final worker = await _worker;
        final order = await worker.invoke<List<int>>(
          _ContentShardsNearOperation(sessionId: sessionId, href: href),
        );
        lane.restart(order);
      } on Object catch (error, stackTrace) {
        lane.near = null;
        // A session disposed while its order was on the way has nothing
        // left to supply; any other failure is reported, never silent.
        if (!lane.stopped) {
          Zone.current.handleUncaughtError(error, stackTrace);
        }
      }
    }());
  }

  /// Runs [attempt] again after supplying what it waited on. Only resource
  /// reads wait on shards, and they carry no request identity, so the retry
  /// is the same call.
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
}
