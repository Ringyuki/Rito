import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';
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

  test(
    'peek publishes a read-only neighbor and turn fast-commits it',
    () async {
      final publication = File(
        '../rito/tests/fixtures/books/book-10.epub',
      ).readAsBytesSync();
      const sessionId = 9003;
      const work = RitoWorkBudget(
        maxTopLevelNodesPerQuantum: 32,
        maxForegroundQuanta: 64,
        localPageCap: 16,
      );
      final gateway = RitoIsolateGateway();
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: publication,
        request: const RitoArtifactRequest(
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
          locator: RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
          work: work,
        ),
      );
      try {
        final first = session.firstArtifact;
        final second = await session.turn(
          from: first,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.next,
          work: work,
        );

        // Peek the previous neighbor: no visible change, fully prepared.
        final peeked = await session.peek(
          from: second,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.previous,
          work: work,
        );
        expect(peeked, isNotNull);
        expect(session.visibleArtifactId, second.artifactId);
        expect(peeked!.artifact.localPageIndex, first.artifact.localPageIndex);

        // Turn onto the peeked page: fast path commits the same artifact.
        final committed = await session.turn(
          from: second,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.previous,
          work: work,
        );
        expect(committed.artifactId, peeked.artifactId);
        expect(session.visibleArtifactId, peeked.artifactId);

        // An unpaginated far neighbor peeks as null.
        final far = await session.peek(
          from: committed,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.previous,
          work: work,
        );
        if (far != null) {
          await session.releaseArtifact(far);
        }
        await session.releaseArtifact(first);
        await session.releaseArtifact(second);
      } finally {
        await session.dispose();
        await gateway.close();
      }
    },
  );

  test(
    'peek hits from publication-backed spreads after background adoption',
    () async {
      final publication = File(
        '../rito/tests/fixtures/books/book-10.epub',
      ).readAsBytesSync();
      const sessionId = 9004;
      const work = RitoWorkBudget(
        maxTopLevelNodesPerQuantum: 32,
        maxForegroundQuanta: 8,
        localPageCap: 16,
      );
      final gateway = RitoIsolateGateway();
      final session = await RitoReaderSession.open(
        gateway: gateway,
        publicationBytes: publication,
        request: const RitoArtifactRequest(
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
          locator: RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
          work: work,
        ),
      );
      try {
        final first = session.firstArtifact;

        // Drive the background pump until it produces the publication
        // candidate for the visible spread, then adopt it — the live
        // reading path after which every visible artifact is
        // publication-backed.
        RitoPreparedArtifact? candidate;
        for (var quantum = 0; quantum < 512 && candidate == null; quantum++) {
          final advance = await session.advanceBackground(
            maxTopLevelNodesPerQuantum: 32,
          );
          candidate = advance.artifact;
          if (candidate != null) {
            await session.adoptBackground(advance);
          }
        }
        expect(candidate, isNotNull, reason: 'background pump must hand off');
        await session.releaseArtifact(first);

        // Turn into the chapter body, then peek the next spread. The
        // neighbor is not laid out ahead of time; peek paginates it.
        final inBody = await session.turn(
          from: candidate!,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.next,
          work: work,
        );
        await session.releaseArtifact(candidate);
        final peeked = await session.peek(
          from: inBody,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.next,
          work: work,
        );
        expect(peeked, isNotNull, reason: 'in-book peek must hit');
        expect(session.visibleArtifactId, inBody.artifactId);
        expect(
          peeked!.artifact.localPageIndex,
          inBody.artifact.localPageIndex + 1,
        );

        // Turn onto the peeked spread: fast path commits the same artifact.
        final committed = await session.turn(
          from: inBody,
          requestId: session.nextRequestId,
          direction: RitoAdjacentDirection.next,
          work: work,
        );
        expect(committed.artifactId, peeked.artifactId);
        expect(session.visibleArtifactId, peeked.artifactId);

        await session.releaseArtifact(inBody);
      } finally {
        await session.dispose();
        await gateway.close();
      }
    },
  );

  test('footnote hits read back and book pages number the whole book', () async {
    // book-01 Section002 carries an image-marked noteref on its first
    // page. Text-only markers whose glyph is CSS-generated leave no hit
    // to tap, so the corpus choice matters here.
    final publication = File(
      '../rito/tests/fixtures/books/book-01.epub',
    ).readAsBytesSync();
    const sessionId = 9005;
    const work = RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 32,
      maxForegroundQuanta: 64,
      localPageCap: 16,
    );
    final gateway = RitoIsolateGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: publication,
      request: const RitoArtifactRequest(
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
        locator: RitoLocator(href: 'OEBPS/Text/Section002.xhtml'),
        work: work,
      ),
    );
    try {
      var current = session.firstArtifact;
      // A chapter-local artifact has no book-wide numbering: its page
      // index is a rollover-window ordinal, so the fields stay absent.
      expect(current.artifact.bookPageIndex, isNull);
      expect(current.artifact.bookPageCount, isNull);

      // Walk forward looking for a noteref, reading each one back with
      // the key exactly as the hit published it.
      var read = 0;
      for (var step = 0; step < 12; step++) {
        final keys = current.artifact.pages
            .expand((page) => page.hits)
            .where((hit) => hit.footnoteKey != null && !hit.footnotePending)
            .map((hit) => hit.footnoteKey!)
            .toSet();
        for (final key in keys) {
          final footnote = await session.readFootnote(current, key);
          expect(footnote.key, key, reason: 'the key round-trips verbatim');
          expect(footnote.text, isNotEmpty);
          read += 1;
        }
        final RitoPreparedArtifact next;
        try {
          next = await session.turn(
            from: current,
            requestId: session.nextRequestId,
            direction: RitoAdjacentDirection.next,
            work: work,
          );
        } on Object {
          break;
        }
        if (!identical(current, session.firstArtifact)) {
          await session.releaseArtifact(current);
        }
        current = next;
      }
      // The corpus book carries notes; a zero here means the hit never
      // classified one and the whole surface is dead.
      expect(read, greaterThan(0), reason: 'at least one footnote resolved');

      // An unknown key fails as "not published" (status 6) rather than
      // taking down the session — the same shape a pending definition
      // reports, so a host retries with one path.
      await expectLater(
        session.readFootnote(current, 'OEBPS/Text/nope.xhtml#missing'),
        throwsA(
          isA<RitoNativeException>().having((e) => e.status, 'status', 6),
        ),
      );
    } finally {
      await session.dispose();
      await gateway.close();
    }
  });

  test('a reader who never turns a page still receives the book total', () async {
    final publication = File(
      '../rito/tests/fixtures/books/book-10.epub',
    ).readAsBytesSync();
    const sessionId = 9006;
    const work = RitoWorkBudget(
      maxTopLevelNodesPerQuantum: 32,
      maxForegroundQuanta: 64,
      localPageCap: 16,
    );
    final gateway = RitoIsolateGateway();
    final session = await RitoReaderSession.open(
      gateway: gateway,
      publicationBytes: publication,
      request: const RitoArtifactRequest(
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
      ),
    );
    try {
      final first = session.firstArtifact;
      expect(first.artifact.bookPageIndex, isNull);

      // Pump to completion, adopting every candidate, never turning.
      RitoPreparedArtifact? visible;
      int? total;
      for (var quantum = 0; quantum < 4096; quantum++) {
        final advance = await session.advanceBackground(
          maxTopLevelNodesPerQuantum: 64,
        );
        final candidate = advance.artifact;
        if (candidate != null) {
          await session.adoptBackground(advance);
          final previous = visible ?? first;
          if (!identical(previous, first)) {
            await session.releaseArtifact(previous);
          }
          visible = candidate;
          total = candidate.artifact.bookPageCount;
        }
        if (advance.advance.state == RitoBackgroundState.complete &&
            total != null) {
          break;
        }
      }
      expect(visible, isNotNull, reason: 'the pump must hand off');
      expect(visible!.artifact.bookPageIndex, isNotNull);
      expect(
        total,
        isNotNull,
        reason: 'completion must deliver the book page count without a turn',
      );
      expect(total, greaterThan(0));
      expect(visible.artifact.bookPageIndex, lessThan(total!));

      await session.releaseArtifact(first);
    } finally {
      await session.dispose();
      await gateway.close();
    }
  });
}
