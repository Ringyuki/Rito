import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_native.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

/// The Reader v1 protocol version lives in one Rust constant and is
/// mirrored by hand into every decoder. A bump that misses one mirror
/// bricks that message type at runtime while hand-built fixtures keep
/// agreeing with the stale gate, so this reads the real constant out of
/// the Rust source and pins every mirror to it.

RitoPinnedFontPolicy _testPinnedPolicy() {
  final pinned = File(
    '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
  ).readAsBytesSync();
  return RitoPinnedFontPolicy(
    faces: <RitoPinnedFontFace>[
      RitoPinnedFontFace(
        bytes: pinned,
        genericRole: RitoPinnedFontGenericRole.serif,
      ),
    ],
  );
}

void main() {
  final repoRoot = _findRepoRoot();

  int rustProtocolVersion() {
    final source = File(
      '$repoRoot/crates/rito-core/src/runtime/reader_v1.rs',
    ).readAsStringSync();
    final match = RegExp(
      r'READER_PROTOCOL_VERSION_V1:\s*u32\s*=\s*(\d+)',
    ).firstMatch(source);
    expect(match, isNotNull, reason: 'the Rust constant must be findable');
    return int.parse(match!.group(1)!);
  }

  test('every Dart decoder gates on the Rust protocol version', () {
    final expected = rustProtocolVersion();
    expect(
      RitoArtifactDecoder.protocolVersion,
      expected,
      reason: 'artifact decoder mirrors the Rust constant',
    );

    // The publication decoder has no constant of its own by design — it
    // must read the same one, not a literal.
    final publicationSource = File(
      '$repoRoot/packages/rito_flutter/lib/src/protocol/publication_decoder.dart',
    ).readAsStringSync();
    expect(
      publicationSource,
      contains('protocolVersion != RitoArtifactDecoder.protocolVersion'),
      reason: 'a literal here is how the last version bump bricked open()',
    );
  });

  test('every JavaScript decoder gates on the Rust protocol version', () {
    final expected = rustProtocolVersion();
    final base = File(
      '$repoRoot/packages/rito-core-wasm/src/reader-v1-wire-base-runtime.js',
    ).readAsStringSync();
    final match = RegExp(
      r'READER_V1_PROTOCOL_VERSION\s*=\s*(\d+)',
    ).firstMatch(base);
    expect(match, isNotNull, reason: 'the JS mirror constant must exist');
    expect(int.parse(match!.group(1)!), expected);

    // Both JS decoders must reference that constant rather than a
    // literal of their own.
    for (final name in const [
      'reader-v1-artifact-decoder-runtime.js',
      'reader-v1-publication-runtime.js',
    ]) {
      final source = File(
        '$repoRoot/packages/rito-core-wasm/src/$name',
      ).readAsStringSync();
      expect(
        RegExp(r'protocolVersion !== \d').hasMatch(source),
        isFalse,
        reason: '$name must not gate on a literal version',
      );
      expect(source, contains('READER_V1_PROTOCOL_VERSION'), reason: name);
    }
  });

  test('a real publication decodes end to end after a version bump', () async {
    // The decisive check: bytes produced by the live Rust encoder, not a
    // hand-built fixture that can agree with a stale gate.
    final publication = File(
      '$repoRoot/packages/rito/tests/fixtures/books/book-10.epub',
    ).readAsBytesSync();
    const sessionId = 9101;
    final bindings = RitoNativeBindings();
    RitoArtifact? artifact;
    try {
      artifact = bindings.openEncoded(
        publicationBytes: publication,
        pinnedFontPolicy: _testPinnedPolicy(),
        requestBytes: const RitoRequestEncoder().encode(
          const RitoArtifactRequest(
            sessionId: sessionId,
            requestId: 1,
            layout: RitoLayoutRequest(
              viewportWidth: 420,
              viewportHeight: 640,
              marginTop: 24,
              marginRight: 24,
              marginBottom: 24,
              marginLeft: 24,
              spreadMode: RitoSpreadMode.single,
              firstPageAlone: true,
              spreadGap: 0,
              rootFontSize: 16,
            ),
            locator: RitoLocator(href: 'OEBPS/Text/Section011.xhtml'),
            work: RitoWorkBudget(
              maxTopLevelNodesPerQuantum: 32,
              maxForegroundQuanta: 64,
              localPageCap: 16,
            ),
          ),
        ),
      );
      expect(artifact.protocolVersion, rustProtocolVersion());
      // The decisive assertion for issue 1: a stale literal here makes
      // this throw and take the whole session down with it.
      final publicationInfo = const RitoPublicationDecoder().decode(
        bindings.readPublicationEncoded(sessionId: sessionId),
      );
      expect(publicationInfo.sessionId, sessionId);
      expect(publicationInfo.spine, isNotEmpty);
    } finally {
      if (artifact != null) {
        bindings.releaseArtifact(
          sessionId: sessionId,
          artifactId: artifact.artifactId,
        );
      }
      bindings.dispose(sessionId: sessionId);
    }
  });
}

String _findRepoRoot() {
  var directory = Directory.current;
  while (true) {
    if (File('${directory.path}/pnpm-workspace.yaml').existsSync() ||
        Directory('${directory.path}/crates').existsSync()) {
      return directory.path;
    }
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError('repository root not found from ${Directory.current}');
    }
    directory = parent;
  }
}
