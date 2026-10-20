import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_gpu/gpu.dart' as gpu;

import '../../native/bindings.dart';
import '../effects.dart';
import '../motion.dart';
import '../page_textures.dart';
import 'leaf_pages.dart';
import 'model.dart';
import 'page_snapshots.dart';
import 'paper_physics.dart';
import 'render/paper_frame.dart';
import 'render/renderer.dart';

/// Where the paper turn's shaders are, as the app's asset bundle has them,
/// and as this package's own tests do.
const _bundles = [
  'packages/rito_flutter/build/shaderbundles/paper.shaderbundle',
  'build/shaderbundles/paper.shaderbundle',
];

enum _Standing { unknown, starting, ready, none }

final class _Repaint extends ChangeNotifier {
  bool _asked = false;

  void now() => notifyListeners();

  /// Paints again next frame: a page on a clock of its own still moves,
  /// or a page not yet drawn for the GPU is asked for again.
  void nextFrame() {
    if (_asked) return;
    _asked = true;
    SchedulerBinding.instance
      ..scheduleFrameCallback((_) {
        _asked = false;
        notifyListeners();
      })
      ..scheduleFrame();
  }
}

/// A page turned as paper is, as the web reader turns it: curled over on
/// itself, peeled back from its outer edge or a corner round a soft roll,
/// its back showing its own print through, until the line it leaves the
/// page at reaches the spine. Under a finger the edge of the paper turned
/// over is where the finger is; let go, the page finishes by itself. It is
/// drawn in three dimensions, lit from over the reader's shoulder, with its
/// shadow on the page beneath. How the paper moves and where every point of
/// it is are the engine's, the same as on the web.
///
/// It is drawn with Flutter GPU, which an app enables (on Android the
/// `io.flutter.embedding.android.EnableFlutterGPU` meta-data, on iOS
/// `FLTEnableFlutterGPU` in Info.plist) and which needs Impeller. It samples
/// the textures the page images were drawn into; a turn waits the moment
/// it takes for a page image just made to be drawn ([canDraw]). Where Flutter
/// GPU is not to be had, turns are drawn as [RitoPageTurnEffects.cover].
/// Make one per controller, and [dispose] it with the controller.
final class RitoPaperTurnEffect extends RitoPageTurnEffect {
  RitoPaperTurnEffect({
    this.paper = const Color(0xFFFFFFFF),
    double Function()? now,
  }) : _clock = now {
    _physics = PaperTurnPhysics(() => _model, _now);
  }

  /// The paper's colour: what shows where a page's image is transparent.
  final Color paper;

  /// The clock the leaf moves by, in ms; the effect's own when not given.
  final double Function()? _clock;
  final _own = Stopwatch()..start();
  late final RitoPaperTurnModel _model = RitoPaperTurnModel();
  late final PaperTurnPhysics _physics;
  final _repaint = _Repaint();
  late final _snapshots = PaperPageSnapshots<gpu.Texture>(
    share: (image) =>
        _renderer!.pageOf(gpu.Texture.fromImage(gpu.gpuContext, image)),
    onGivenUp: (error, stack) {
      if (_givenUp) return;
      _givenUp = true;
      _report(
        error,
        stack,
        'sharing a page with the GPU; its turn is drawn plain',
      );
    },
  );
  bool _givenUp = false;
  final _leaves = PaperLeafPages();
  final _points = <RitoNativePaperTurnPoints>[];
  PaperRenderer? _renderer;
  var _standing = _Standing.unknown;

  /// The leaf whose turn began before it could be drawn as paper, and is
  /// drawn plain to its end; a leaf appearing halfway would be a jump.
  int? _plain;

  double _now() => _clock?.call() ?? _own.elapsedMicroseconds / 1000;

  @override
  Listenable get repaint => _repaint;

  @override
  RitoPageTurnPhysics get physics => _physics;

  @override
  void warm(RitoPageTurnPages pages) {
    _start(pages.pixelRatio);
    for (final slot in RitoPageSlot.values) {
      final image = pages.image(slot);
      if (image != null) _textureOf(image, pages.spread(slot));
    }
  }

  /// No while the programs are being readied, or while the page on screen
  /// or the one coming in has no texture yet: an image just made does once
  /// the raster thread has drawn it, which is asked about every frame.
  @override
  bool canDraw(RitoPageTurnPages pages, RitoPageSlot incoming) {
    _start(pages.pixelRatio);
    if (_standing == _Standing.none) return true;
    if (_standing == _Standing.starting) return false;
    for (final slot in [RitoPageSlot.current, incoming]) {
      final image = pages.image(slot);
      if (image == null || _snapshots.hasNone(image)) continue;
      if (_textureOf(image, pages.spread(slot)) == null) {
        _repaint.nextFrame();
        return false;
      }
    }
    return true;
  }

  @override
  void paint(RitoPageTurnScene scene, RitoPageTurnFrame frame) {
    final pages = scene.pages;
    final ratio = pages.pixelRatio;
    _start(ratio);
    final current = pages.image(RitoPageSlot.current);
    final slot = frame.incoming;
    final incoming = slot == null ? null : pages.image(slot);
    if (current == null) {
      RitoPageTurnEffects.cover.paint(scene, frame);
      return;
    }
    final input = _inputOf(pages, frame, current, slot, ratio);
    final begun = _model.begin(input);
    _leaves.forget(begun.forgotten);
    // A page turned back before the first page has no leaf to bring back.
    if (!begun.turns) {
      scene.drawPage(RitoPageSlot.current, frame.offset);
      return;
    }
    if (begun.anew) _plain = null;
    final renderer = _renderer;
    _snapshots.keepOnly([
      for (final slot in RitoPageSlot.values) pages.spread(slot),
    ]);
    final front = _textureOf(current, pages.spread(RitoPageSlot.current));
    final back = incoming == null
        ? null
        : _textureOf(incoming, pages.spread(slot!));
    final ready =
        renderer != null && front != null && (incoming == null || back != null);
    // A leaf that has not moved yet is the page at rest: whether it is
    // drawn as paper is not decided before it moves.
    if (!ready && frame.offset == 0) {
      scene.drawPage(RitoPageSlot.current, 0);
      return;
    }
    if (_drawnPlain(begun.spread, ready)) {
      RitoPageTurnEffects.cover.paint(scene, frame);
      return;
    }
    final laid = _model.lay(0)!;
    _leaves.lay(laid, {
      if (input.current != null) input.current!.buffer: front,
      if (input.incomingPage != null) input.incomingPage!.buffer: back,
    });
    final drawn = renderer!.draw(_frameOf(laid, input));
    final image = drawn.asImage();
    scene.canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, input.width, input.height),
      Offset.zero & scene.size,
      Paint()..filterQuality = FilterQuality.low,
    );
    image.dispose();
    // A page under a finger comes to it, and one let go comes down, frame
    // after frame, whether or not the turn has moved.
    if (frame.phase == RitoPageTurnPhase.held || _model.state(_now()).aloft) {
      _repaint.nextFrame();
    }
  }

  /// The frame as the model reads it: in the page images' device pixels,
  /// as the web gives it the canvas's.
  RitoPaperTurnInput _inputOf(
    RitoPageTurnPages pages,
    RitoPageTurnFrame frame,
    ui.Image current,
    RitoPageSlot? slot,
    double ratio,
  ) {
    final touch = frame.touch;
    return RitoPaperTurnInput(
      width: current.width.toDouble(),
      height: current.height.toDouble(),
      spine: 0,
      cssPixel: ratio,
      dx: frame.offset * ratio,
      incoming: slot,
      phase: frame.phase,
      touch: touch == null
          ? null
          : RitoPageTurnTouch(
              origin: touch.origin * ratio,
              position: touch.position * ratio,
              farthest: touch.farthest * ratio,
            ),
      current: _leaves.named(
        _holder(pages, RitoPageSlot.current),
        pages.spread(RitoPageSlot.current),
      ),
      incomingPage: slot == null
          ? null
          : _leaves.named(_holder(pages, slot), pages.spread(slot)),
      now: _now(),
      epoch: 0,
    );
  }

  PaperFrame _frameOf(RitoPaperTurnLaid laid, RitoPaperTurnInput input) {
    final length = laid.columns * laid.rows * 3;
    final sheets = <PaperSheet>[];
    for (var index = 0; index < laid.sheets; index += 1) {
      if (_points.length <= index) {
        _points.add(RitoNativePaperTurnPoints(length));
      } else if (_points[index].length != length) {
        _points[index].dispose();
        _points[index] = RitoNativePaperTurnPoints(length);
      }
      final sheet = _model.sheet(index, _points[index]);
      sheets.add(
        PaperSheet(
          positions: _points[index].positions,
          normals: _points[index].normals,
          front: _leaves.face(sheet.front),
          back: _leaves.face(sheet.back),
          shown: sheet.shown,
          curl: sheet.curl,
          still: sheet.still != null,
        ),
      );
    }
    return PaperFrame(
      width: input.width,
      height: input.height,
      spine: input.spine,
      columns: laid.columns,
      rows: laid.rows,
      eye: _model.eyeHeight(
        input.width.roundToDouble(),
        input.height.roundToDouble(),
      ),
      sheets: sheets,
      paper: [paper.r, paper.g, paper.b],
    );
  }

  /// What stands for the page in [slot]: its page, or its image where
  /// there is no page.
  static Object? _holder(RitoPageTurnPages pages, RitoPageSlot slot) =>
      pages is RitoPageTextures ? pages.page(slot) : pages.image(slot);

  /// The texture the page [spread] shown by [image] is sampled from.
  gpu.Texture? _textureOf(ui.Image image, int? spread) {
    if (_standing != _Standing.ready) return null;
    return _snapshots.of(image, spread);
  }

  /// Whether the turn of [leaf] is drawn plain: it began before the GPU or
  /// its pages were ready, and stays plain to its end; nothing waits.
  bool _drawnPlain(int leaf, bool ready) {
    if (_plain == leaf) return true;
    _plain = ready ? null : leaf;
    return !ready;
  }

  /// Readies Flutter GPU and the paper's programs, once; where they cannot
  /// be had, says so once and turns are drawn plain.
  void _start(double pixelRatio) {
    if (_standing != _Standing.unknown) return;
    try {
      gpu.gpuContext;
    } on Object catch (error, stack) {
      _standing = _Standing.none;
      _report(error, stack, 'starting the paper turn; turns are drawn plain');
      return;
    }
    _standing = _Standing.starting;
    _library()
        .then((library) => PaperRenderer.start(library, pixelRatio: pixelRatio))
        .then(
          (renderer) {
            _renderer = renderer;
            _standing = _Standing.ready;
            _repaint.now();
          },
          onError: (Object error, StackTrace stack) {
            _standing = _Standing.none;
            _report(
              error,
              stack,
              'starting the paper turn; turns are drawn plain',
            );
            // A turn waiting for the programs is drawn plain instead.
            _repaint.now();
          },
        );
  }

  static Future<gpu.ShaderLibrary> _library() async {
    Object? failure;
    for (final key in _bundles) {
      try {
        final library = await gpu.ShaderLibrary.fromAsset(key);
        if (library != null) return library;
      } on Object catch (error) {
        failure = error;
      }
    }
    throw StateError('The paper turn\'s shaders are not in the app: $failure');
  }

  static void _report(Object error, StackTrace stack, String doing) {
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stack,
        library: 'rito_flutter',
        context: ErrorDescription(doing),
      ),
    );
  }

  /// Lets go of the engine's model and what the effect holds.
  void dispose() {
    for (final points in _points) {
      points.dispose();
    }
    _points.clear();
    _model.dispose();
    _repaint.dispose();
  }
}
