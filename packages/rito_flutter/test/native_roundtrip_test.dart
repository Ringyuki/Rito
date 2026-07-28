import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter_native.dart';
import 'package:rito_flutter/rito_flutter_protocol.dart';

void main() {
  test('real Rust Native Asset round-trips RITOART1 and RITONAV1', () {
    final publication = File(
      '../rito/tests/fixtures/books/book-10.epub',
    ).readAsBytesSync();
    const sessionId = 9001;
    const work = RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 32,
      maxForegroundQuanta: 64,
      localPageCap: 16,
    );
    const request = RitoArtifactRequest(
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
      work: work,
    );
    const encoder = RitoRequestEncoder();
    const foregroundEncoder = RitoForegroundEncoder();
    const foregroundDecoder = RitoForegroundDecoder();
    final bindings = RitoNativeBindings();
    RitoArtifact? first;
    RitoArtifact? next;

    try {
      first = bindings.openEncoded(
        publicationBytes: publication,
        requestBytes: encoder.encode(request),
      );
      expect(first.sessionId, sessionId);
      expect(first.requestId, 1);
      expect(first.locator.href, request.locator.href);
      expect(first.displayList.displayList.commands, isNotEmpty);
      final initialAck = foregroundDecoder.decodeHandoffAck(
        bindings.adoptForegroundCandidateEncoded(
          sessionId: sessionId,
          requestBytes: foregroundEncoder.encodeHandoff(
            RitoForegroundHandoff(
              sessionId: sessionId,
              candidateArtifactId: first.artifactId,
            ),
          ),
        ),
      );
      expect(initialAck.replacedArtifactId, isNull);
      expect(initialAck.visibleArtifactId, first.artifactId);

      next = bindings.requestAdjacentEncoded(
        sessionId: sessionId,
        requestBytes: encoder.encodeAdjacent(
          RitoAdjacentRequest(
            sessionId: sessionId,
            requestId: 2,
            fromArtifactId: first.artifactId,
            direction: RitoAdjacentDirection.next,
            work: work,
          ),
        ),
      );
      expect(next.sessionId, sessionId);
      expect(next.requestId, 2);
      expect(next.artifactId, isNot(first.artifactId));
      expect(next.revisionId, first.revisionId);
      expect(next.localSpreadIndex, greaterThan(first.localSpreadIndex));
      final nextAck = foregroundDecoder.decodeHandoffAck(
        bindings.adoptForegroundCandidateEncoded(
          sessionId: sessionId,
          requestBytes: foregroundEncoder.encodeHandoff(
            RitoForegroundHandoff(
              sessionId: sessionId,
              expectedVisibleArtifactId: first.artifactId,
              candidateArtifactId: next.artifactId,
            ),
          ),
        ),
      );
      expect(nextAck.replacedArtifactId, first.artifactId);
      expect(nextAck.visibleArtifactId, next.artifactId);
    } finally {
      if (next != null) {
        bindings.releaseArtifact(
          sessionId: sessionId,
          artifactId: next.artifactId,
        );
      }
      if (first != null) {
        bindings.releaseArtifact(
          sessionId: sessionId,
          artifactId: first.artifactId,
        );
      }
      bindings.dispose(sessionId: sessionId);
    }
  });
  test('pinned font policy open declares embedded publication faces', () {
    final publication = File(
      '../../apps/reader/src/assets/demo.epub',
    ).readAsBytesSync();
    final pinned = File(
      '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
    ).readAsBytesSync();
    const sessionId = 9002;
    const request = RitoArtifactRequest(
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
      locator: RitoLocator(href: 'OEBPS/Text/Section001.xhtml'),
      work: RitoWorkBudget(
        maxTopLevelNodesPerQuantum: 32,
        maxForegroundQuanta: 64,
        localPageCap: 16,
      ),
    );
    final bindings = RitoNativeBindings();
    RitoArtifact? artifact;
    try {
      artifact = bindings.openEncoded(
        publicationBytes: publication,
        requestBytes: const RitoRequestEncoder().encode(request),
        pinnedFontPolicy: RitoPinnedFontPolicy(
          faces: <RitoPinnedFontFace>[
            RitoPinnedFontFace(
              bytes: pinned,
              genericRole: RitoPinnedFontGenericRole.serif,
            ),
          ],
        ),
      );
      expect(
        artifact.fonts,
        isNotEmpty,
        reason: 'a pinned-font open must declare embedded publication faces',
      );
      expect(
        artifact.resources.any(
          (resource) => resource.kind == RitoResourceKind.font,
        ),
        isTrue,
      );
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
