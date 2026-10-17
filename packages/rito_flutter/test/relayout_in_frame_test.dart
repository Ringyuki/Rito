import 'dart:async';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rito_flutter/rito_flutter.dart';

RitoLayoutRequest _layout(double width) => RitoLayoutRequest(
  viewportWidth: width,
  viewportHeight: 640,
  marginTop: 24,
  marginRight: 24,
  marginBottom: 24,
  marginLeft: 24,
  spreadMode: RitoSpreadMode.single,
  firstPageAlone: true,
  spreadGap: 0,
  rootFontSize: 16,
);

Future<RitoReaderSession> _open(int sessionId) => RitoReaderSession.open(
  gateway: RitoNativeGateway(),
  publicationBytes: File(
    '../rito/tests/fixtures/books/book-10.epub',
  ).readAsBytesSync(),
  request: RitoArtifactRequest(
    sessionId: sessionId,
    requestId: 1,
    layout: _layout(420),
    locator: const RitoLocator(href: 'OEBPS/Text/Section013.xhtml'),
  ),
  pinnedFontPolicy: RitoPinnedFontPolicy(
    faces: <RitoPinnedFontFace>[
      RitoPinnedFontFace(
        bytes: File(
          '../../apps/reader/src/assets/fonts/Tinos-Regular.ttf',
        ).readAsBytesSync(),
        genericRole: RitoPinnedFontGenericRole.serif,
      ),
    ],
  ),
);

/// A host that lays the book out again when the window changes size, the
/// way an app filling its window does, and records the width of the page
/// every frame builds with.
class _Host extends StatefulWidget {
  const _Host(this.controller, this.built);

  final RitoReaderController controller;
  final List<double> built;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    final view = View.of(context);
    final width = view.physicalSize.width / view.devicePixelRatio;
    unawaited(widget.controller.relayout(_layout(width)));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      widget.built.add(widget.controller.page.artifact.width);
      return const SizedBox.expand();
    },
  );
}

void main() {
  // Real frames and a real event loop: the session's own futures run as
  // they do in an app, not in the test's fake async zone.
  final binding = LiveTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  test('a relayout completes within the task that asks for it', () async {
    final session = await _open(9921);
    final controller = RitoReaderController(session, layout: _layout(420));
    final release = controller.holdPagination();
    try {
      var done = false;
      unawaited(controller.relayout(_layout(380)).then((_) => done = true));
      // The engine answers on this isolate: no timer, isolate message or
      // frame comes between the ask and the new page.
      for (var turn = 0; turn < 100 && !done; turn += 1) {
        await Future<void>.microtask(() {});
      }
      expect(done, isTrue);
      expect(controller.page.artifact.width, 380);
    } finally {
      release();
      controller.dispose();
      await session.dispose();
    }
  });

  testWidgets(
    'the frame in which the window changes size draws the new layout',
    (tester) async {
      final session = await _open(9922);
      final controller = RitoReaderController(session, layout: _layout(420));
      final release = controller.holdPagination();
      final built = <double>[];
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(420, 640);
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_Host(controller, built));
      expect(built.last, 420);

      for (final width in <double>[400, 360, 330]) {
        built.clear();
        tester.view.physicalSize = Size(width, 640);
        await tester.pump();
        expect(built, <double>[width], reason: 'the first frame at $width');
      }
      release();
      controller.dispose();
      await session.dispose();
    },
  );
}
