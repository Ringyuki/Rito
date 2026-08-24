import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('adapter has no product, network, JSON, or WebView dependency', () {
    final source = _sourceUnder('lib');
    for (final forbidden in <String>[
      'webview',
      'dio',
      'hikarinagi',
      'jsondecode',
      'httpclient',
    ]) {
      expect(source.toLowerCase(), isNot(contains(forbidden)));
    }
  });

  test('widgets only replay artifacts and native work is isolated', () {
    final render = _sourceUnder('lib/src/render');
    expect(render, isNot(contains('RitoNativeBindings')));
    expect(render, isNot(contains('requestArtifact')));
    expect(render, isNot(contains('RitoRequestEncoder')));

    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    expect(gateway, contains("part 'worker.dart'"));
    final worker = File('lib/src/native/worker.dart').readAsStringSync();
    expect(worker, contains('Isolate.spawn'));
  });

  test('exact initial open is cooperative, bounded, and never UI-synchronous', () {
    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    final pending = File(
      'lib/src/native/pending_open.dart',
    ).readAsStringSync();
    final bindings = File(
      'lib/src/native/bindings.dart',
    ).readAsStringSync();
    final worker = File('lib/src/native/worker.dart').readAsStringSync();

    expect(gateway, contains('Future<void>.delayed(Duration.zero)'));
    expect(gateway, contains('_pendingExactSeek.resume('));
    expect(
      '_oneQuantumRequestWithId(request, intent.requestId)'.allMatches(gateway),
      hasLength(2),
    );
    expect(gateway, contains('maxForegroundQuanta: 1'));
    expect(gateway, contains('RitoResumableExactSeekGateway'));
    expect(gateway, isNot(contains('RitoResumableOpenGateway')));
    expect(
      gateway,
      contains('initialOperation: () => _requestArtifactOnce(nativeRequest)'),
    );
    expect(gateway, contains('return _requestArtifactOnce(continuation)'));
    expect(pending, contains('maxForegroundQuanta: 1'));
    expect(pending, contains('quantum < maxContinuationQuanta'));
    expect(pending, contains('RitoPendingExactSeekLimitException('));
    expect(bindings, contains('ritoNativeStatusExactSeekPendingV1 = 9'));
    expect(pending, isNot(contains('.message')));
    expect(worker, contains('liveSessions.add(operation.sessionId)'));
    expect(worker, isNot(contains('Future<void>.delayed')));
  });

  test('adjacent turns retain only typed bounded one-quantum work', () {
    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    final pending = File(
      'lib/src/native/pending_adjacent.dart',
    ).readAsStringSync();
    final bindings = File(
      'lib/src/native/bindings.dart',
    ).readAsStringSync();
    final session = File('lib/src/reader_session.dart').readAsStringSync();

    expect(gateway, contains('_pendingAdjacent.resume('));
    expect(gateway, contains('oneQuantumAdjacentRequest('));
    expect(gateway, contains('RitoResumableAdjacentGateway'));
    expect(gateway, contains('_adjacentIntentKey(request)'));
    expect(pending, contains('maxForegroundQuanta: 1'));
    expect(pending, contains('quantum < maxContinuationQuanta'));
    expect(pending, contains('RitoPendingAdjacentLimitException('));
    expect(pending, contains('ritoPendingAdjacentContinuationCapV1 = 4096'));
    expect(pending, isNot(contains('.message')));
    expect(bindings, contains('ritoNativeStatusAdjacentPendingV1 = 10'));
    expect(bindings, contains('ritoNativeStatusSessionTerminatedV1 = 11'));
    expect(bindings, contains('_terminatedSessionResultError('));
    expect(
      bindings,
      contains("_terminatedSessionResultError('initial artifact', error)"),
    );
    expect(session, contains('_acceptsResumedAdjacent(request, artifact)'));
    expect(session, contains('_syncConsumedAdjacentRequestId(request)'));
    expect(session, contains('_recordConsumedRequestId(artifact.requestId)'));
    expect(gateway, contains('_guardNativeMutation<RitoArtifact>'));
    expect(
      '_guardNativeMutation'.allMatches(gateway).length,
      greaterThanOrEqualTo(7),
    );
    expect(
      '_guardNativeSessionOperation'.allMatches(gateway).length,
      greaterThanOrEqualTo(4),
    );
    expect(
      gateway,
      contains('error.status == ritoNativeStatusSessionTerminatedV1'),
    );
    expect(
      gateway,
      contains('error.status != ritoNativeStatusNotFoundV1'),
    );
    expect(
      gateway,
      contains('error.status != ritoNativeStatusEngineErrorV1'),
    );
  });

  test('large native bytes cross isolates through transferable transport', () {
    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    final worker = File('lib/src/native/worker.dart').readAsStringSync();
    final transfer = File(
      'lib/src/native/owned_byte_transfer.dart',
    ).readAsStringSync();
    final nativeEntry = File('lib/rito_flutter_native.dart').readAsStringSync();

    expect(gateway, contains('RitoOwnedByteTransfer.take(publicationBytes)'));
    expect(gateway, contains('await worker.invokeWire('));
    expect(gateway, contains('_artifactDecoder.decode(wireBytes)'));
    expect(gateway, contains('decode: _resourceDecoder.decode'));
    expect(gateway, contains('_decodeSessionWire<RitoResource>'));
    expect(gateway, contains('resource.href == href'));
    expect(gateway, contains('_rejectMalformedArtifact('));
    expect(worker, contains('final TransferableTypedData publicationBytes;'));
    expect(worker, contains('RitoNativeWireBindings'));
    expect(worker, contains('if (value is! Uint8List)'));
    expect(worker, contains('RitoOwnedByteTransfer.take(value)'));
    expect(transfer, contains('TransferableTypedData.fromList'));
    expect(transfer, contains('transfer.materialize().asUint8List()'));
    expect(worker, isNot(contains('final Uint8List publicationBytes;')));
    expect(nativeEntry, isNot(contains('RitoNativeWireBindings')));
  });

  test('Native Assets are primary and the Cargo hook is strictly serial', () {
    final binding = File('lib/src/native/bindings.dart').readAsStringSync();
    expect(binding, contains('@Native<_OpenNative>'));
    expect(binding, contains('assetId: ritoNativeAssetId'));
    expect(binding, contains("symbol: 'rito_request_adjacent_v1'"));
    expect(binding, contains("symbol: 'rito_read_publication_v1'"));
    expect(
      binding,
      contains("symbol: 'rito_adopt_foreground_candidate_v1'"),
    );
    expect(binding, contains("symbol: 'rito_advance_background_v1'"));
    expect(
      binding,
      contains("symbol: 'rito_adopt_background_candidate_v1'"),
    );
    expect(binding, contains('RitoNativeBindings.fromDynamicLibrary'));

    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    expect(gateway, contains('RitoIsolateGateway({this.diagnosticLibrary})'));

    final hook = _sourceUnder('hook');
    expect(hook, contains("'--jobs',"));
    expect(hook, contains("'CARGO_BUILD_JOBS': '1'"));
    expect(hook, contains("'CARGO_PROFILE_RELEASE_PANIC': 'unwind'"));
    expect(hook, isNot(contains('Future.wait')));
    expect(hook, isNot(contains('Architecture.values')));
  });

  test(
    'default page turn is adjacent-only and stays on the worker isolate',
    () {
      final session = File('lib/src/reader_session.dart').readAsStringSync();
      final turnStart = session.indexOf('Future<RitoPreparedArtifact> turn({');
      expect(turnStart, isNonNegative);
      final adjacentStart = session.indexOf(
        'Future<RitoPreparedArtifact> requestAdjacent',
        turnStart,
      );
      expect(adjacentStart, greaterThan(turnStart));
      final turnBody = session.substring(turnStart, adjacentStart);
      expect(turnBody, contains('RitoAdjacentRequest('));
      expect(turnBody, isNot(contains('requestArtifact(')));

      final worker = File('lib/src/native/worker.dart').readAsStringSync();
      expect(worker, contains('_RequestAdjacentOperation()'));
      expect(worker, contains('bindings.requestAdjacentEncoded('));
    },
  );

  test('prepared candidates require explicit ordered visibility adoption', () {
    final gateway = File('lib/src/native/gateway.dart').readAsStringSync();
    final worker = File('lib/src/native/worker.dart').readAsStringSync();
    final session = File('lib/src/reader_session.dart').readAsStringSync();

    expect(gateway, contains('Future<RitoForegroundHandoffAck> adoptForeground'));
    expect(gateway, contains('_queue.ordered<RitoForegroundHandoffAck>'));
    expect(gateway, contains('_pendingForegroundCandidates'));
    expect(worker, contains('_AdoptForegroundOperation()'));
    expect(worker, contains('_AdvanceBackgroundOperation()'));
    expect(worker, contains('_AdoptBackgroundOperation()'));
    expect(session, contains('await session._prepareInitialCandidate(artifact)'));
    expect(session, contains('await gateway.adoptForeground('));
    expect(session, contains('RitoArtifactResourcePreparer? resourcePreparer'));
    expect(session, contains('artifact.artifactId == _visibleArtifactId'));
    expect(session, contains('Background adoption must yield'));
  });

  test('production RITODL1 is typed and render never parses CSS colors', () {
    final protocol = _sourceUnder('lib/src/protocol');
    final render = _sourceUnder('lib/src/render');
    expect(protocol, isNot(contains('class RitoValue')));
    expect(protocol, isNot(contains('_value(RitoBinaryReader')));
    expect(render, isNot(contains('tryParse')));
    expect(render, isNot(contains("startsWith('#')")));
    expect(render, isNot(contains("startsWith('rgb')")));
    expect(render, contains('RitoColor'));
  });

  test('page paint requires a font-prepared artifact', () {
    final session = File('lib/src/reader_session.dart').readAsStringSync();
    final surface = File('lib/src/render/page_surface.dart').readAsStringSync();
    final fonts = File(
      'lib/src/font/artifact_font_cache.dart',
    ).readAsStringSync();

    expect(
      session,
      contains('await session._prepareInitialCandidate(artifact)'),
    );
    expect(
      session,
      contains('prepared = await _prepareOwnedArtifact(artifact)'),
    );
    expect(surface, contains('final RitoPreparedArtifact artifact;'));
    expect(surface, isNot(contains('final RitoArtifact artifact;')));
    expect(fonts, contains('FontLoader(font.family)'));
    expect(fonts, contains('resource.bytes.length != font.byteLength'));
  });
}

String _sourceUnder(String path) {
  final files = Directory(path)
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart'));
  return files.map((file) => file.readAsStringSync()).join('\n');
}
