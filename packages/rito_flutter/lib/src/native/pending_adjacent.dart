import '../protocol/artifact_models.dart';
import '../protocol/request_models.dart';
import 'bindings.dart';
import 'session_lane.dart';

const int ritoPendingAdjacentContinuationCapV1 = 4096;

final class RitoPendingAdjacentLimitException implements Exception {
  const RitoPendingAdjacentLimitException({
    required this.sessionId,
    required this.initialRequestId,
    required this.lastRequestId,
    required this.maxContinuationQuanta,
  });

  final int sessionId;
  final int initialRequestId;
  final int lastRequestId;
  final int maxContinuationQuanta;

  @override
  String toString() {
    return 'Rito retained adjacent request for session $sessionId exceeded '
        '$maxContinuationQuanta continuation quanta after request '
        '$initialRequestId (last request $lastRequestId).';
  }
}

/// Advances one retained adjacent intent by one quantum per asynchronous host
/// turn. Only the dedicated adjacent-pending status is retryable.
final class RitoPendingAdjacentDriver {
  const RitoPendingAdjacentDriver({
    this.maxContinuationQuanta = ritoPendingAdjacentContinuationCapV1,
  }) : assert(maxContinuationQuanta > 0);

  final int maxContinuationQuanta;

  Future<RitoArtifact> resume({
    required RitoAdjacentRequest initialRequest,
    required Future<RitoArtifact> Function(RitoAdjacentRequest request)
    requestOneQuantum,
    required Future<void> Function() yieldHostTurn,
    required bool Function() isCurrent,
    required int? Function() replacementRequestId,
    required Future<void> Function(Object error, StackTrace stackTrace)
    onTerminal,
  }) async {
    var requestId = initialRequest.requestId;
    for (var quantum = 0; quantum < maxContinuationQuanta; quantum += 1) {
      _requireCurrent(
        initialRequest.sessionId,
        requestId,
        isCurrent,
        replacementRequestId,
      );
      await yieldHostTurn();
      _requireCurrent(
        initialRequest.sessionId,
        requestId,
        isCurrent,
        replacementRequestId,
      );
      if (requestId >= 0x7fffffffffffffff) {
        final failure = StateError(
          'Rito retained adjacent request ID space is exhausted.',
        );
        final stackTrace = StackTrace.current;
        await onTerminal(failure, stackTrace);
        Error.throwWithStackTrace(failure, stackTrace);
      }
      requestId += 1;
      final continuation = oneQuantumAdjacentRequest(initialRequest, requestId);
      try {
        final artifact = await requestOneQuantum(continuation);
        _requireCurrent(
          initialRequest.sessionId,
          requestId,
          isCurrent,
          replacementRequestId,
        );
        return artifact;
      } on Object catch (error, stackTrace) {
        if (!isCurrent()) {
          throw RitoNavigationSupersededException(
            sessionId: initialRequest.sessionId,
            requestId: requestId,
            replacementRequestId: replacementRequestId(),
          );
        }
        if (_isAdjacentPending(error)) {
          continue;
        }
        await onTerminal(error, stackTrace);
        Error.throwWithStackTrace(error, stackTrace);
      }
    }

    final limit = RitoPendingAdjacentLimitException(
      sessionId: initialRequest.sessionId,
      initialRequestId: initialRequest.requestId,
      lastRequestId: requestId,
      maxContinuationQuanta: maxContinuationQuanta,
    );
    final stackTrace = StackTrace.current;
    await onTerminal(limit, stackTrace);
    Error.throwWithStackTrace(limit, stackTrace);
  }
}

RitoAdjacentRequest oneQuantumAdjacentRequest(
  RitoAdjacentRequest request,
  int requestId,
) {
  return RitoAdjacentRequest(
    sessionId: request.sessionId,
    requestId: requestId,
    fromArtifactId: request.fromArtifactId,
    direction: request.direction,
    work: RitoWorkBudget(
      maxTopLevelNodesPerQuantum: request.work.maxTopLevelNodesPerQuantum,
      maxForegroundQuanta: 1,
      localPageCap: request.work.localPageCap,
    ),
  );
}

bool _isAdjacentPending(Object error) {
  return error is RitoNativeException &&
      error.status == ritoNativeStatusAdjacentPendingV1;
}

void _requireCurrent(
  int sessionId,
  int requestId,
  bool Function() isCurrent,
  int? Function() replacementRequestId,
) {
  if (isCurrent()) {
    return;
  }
  throw RitoNavigationSupersededException(
    sessionId: sessionId,
    requestId: requestId,
    replacementRequestId: replacementRequestId(),
  );
}
