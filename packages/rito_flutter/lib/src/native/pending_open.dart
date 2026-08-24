import 'dart:async';

import '../protocol/artifact_models.dart';
import '../protocol/request_models.dart';
import 'bindings.dart';
import 'session_lane.dart';

const int ritoPendingExactSeekContinuationCapV1 = 4096;

/// A resumable native exact seek exceeded the finite continuation bound.
///
/// This bound prevents a malformed native implementation from retaining an
/// exact-seek continuation forever without either publishing or terminating.
final class RitoPendingExactSeekLimitException implements Exception {
  const RitoPendingExactSeekLimitException({
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
    return 'Rito pending exact seek for session $sessionId exceeded '
        '$maxContinuationQuanta continuation quanta after request '
        '$initialRequestId (last request $lastRequestId).';
  }
}

/// Drives an exact-locator continuation one asynchronous host turn at a time.
/// Only the typed exact-seek-pending status is retryable;
/// target-not-published and every other status are terminal. Public only so
/// deterministic adapter tests can use a fake transport.
final class RitoPendingExactSeekDriver {
  const RitoPendingExactSeekDriver({
    this.maxContinuationQuanta = ritoPendingExactSeekContinuationCapV1,
  }) : assert(maxContinuationQuanta > 0);

  final int maxContinuationQuanta;

  Future<RitoArtifact> resume({
    required RitoArtifactRequest initialRequest,
    required Future<RitoArtifact> Function(RitoArtifactRequest request)
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
          'Rito pending exact seek request ID space is exhausted.',
        );
        final stackTrace = StackTrace.current;
        await onTerminal(failure, stackTrace);
        Error.throwWithStackTrace(failure, stackTrace);
      }
      requestId += 1;
      final continuation = _oneQuantumRequest(initialRequest, requestId);
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
        if (_isStatus(error, ritoNativeStatusExactSeekPendingV1)) {
          continue;
        }
        await onTerminal(error, stackTrace);
        Error.throwWithStackTrace(error, stackTrace);
      }
    }

    final limit = RitoPendingExactSeekLimitException(
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

RitoArtifactRequest _oneQuantumRequest(
  RitoArtifactRequest request,
  int requestId,
) {
  return RitoArtifactRequest(
    sessionId: request.sessionId,
    requestId: requestId,
    layout: request.layout,
    locator: request.locator,
    work: RitoWorkBudget(
      maxTopLevelNodesPerQuantum: request.work.maxTopLevelNodesPerQuantum,
      maxForegroundQuanta: 1,
      localPageCap: request.work.localPageCap,
    ),
    textProfile: request.textProfile,
  );
}

bool _isStatus(Object error, int status) {
  return error is RitoNativeException && error.status == status;
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
