import 'dart:math' as math;

import 'package:flutter_gpu/gpu.dart' as gpu;

import '../light.dart';
import 'paper_frame.dart';
import 'passes.dart';
import 'programs.dart';
import 'sheet_buffers.dart';

/// How far from the spine the page beside a standing leaf shares its shade, in leaf widths.
const double _gutter = 0.07;

/// The shadow is worked out this many times smaller than the frame.
const int _shadowScale = 2;

typedef SpineSides = ({double spine, double edge, double left, double right});

/// The small textures a shadow is worked out in.
final class _Targets {
  _Targets(this.width, this.height)
    : blockers = _target(width, height),
      cover = _target(width, height),
      dark = _target(width, height),
      spare = _target(width, height);

  final int width;
  final int height;
  final gpu.Texture blockers;
  final gpu.Texture cover;
  final gpu.Texture dark;
  final gpu.Texture spare;

  static gpu.Texture _target(int width, int height) => gpu.gpuContext
      .createTexture(gpu.StorageMode.devicePrivate, width, height);
}

/// The darkness the leaves in the air leave on the pages (kit `shadow.ts`):
/// what they hide from the eye first, then what each keeps of the light
/// from what is left in sight, then a light blur; laid over the pages
/// drawn so far by [lay].
final class ShadowPass {
  ShadowPass(this._programs, this._quad, this._flip);

  final PaperPrograms _programs;
  final Quad _quad;
  final List<double> _flip;
  _Targets? _targets;
  late SpineSides _sides;

  /// Works out the shadows of a frame `width` by `height` that the
  /// [casters] (indices into the frame's sheets) leave.
  void workOut(
    gpu.HostBuffer host,
    PaperFrame frame,
    SheetGrid grid,
    List<SheetVertices> vertices,
    List<int> casters,
    int width,
    int height,
  ) {
    final targets = _targetsFor(width, height);
    _sides = sidesOf(frame.spine, width.toDouble(), targets.width);
    final size = [width.toDouble(), height.toDouble()];
    // The cover: each standing sheet drawn where it is seen.
    final pass = passInto(targets.cover);
    for (final index in casters) {
      final cover = _programs.cover
        ..set('uSize', size)
        ..set('uEye', [frame.eye])
        ..set('uSpine', [frame.spine])
        ..set('uLine', hidesFrom(frame.sheets[index].curl));
      plain(pass);
      cover.use(pass, host);
      vertices[index].bindCover(pass);
      grid
        ..bindIndices(pass, fromBelow: false)
        ..draw(pass);
    }
    submit(pass);
    submit(passInto(targets.dark));
    for (final index in casters) {
      _occlude(host, frame, grid, vertices[index], targets, index, size);
    }
    // The shadow is sampled with a pattern turned from pixel to pixel; a light blur takes its grain out.
    _blur(host, targets.dark, targets.spare, [1.2 / targets.width, 0]);
    _blur(host, targets.spare, targets.dark, [0, 1.2 / targets.height]);
  }

  _Targets _targetsFor(int width, int height) {
    final w = math.min(1024, math.max(64, (width / _shadowScale).round()));
    final h = math.max(1, (w * height / width).round());
    final kept = _targets;
    if (kept != null && kept.width == w && kept.height == h) return kept;
    return _targets = _Targets(w, h);
  }

  /// Where the leaf stands between the lamp and the pages, then how much
  /// darker it leaves each point of them: what two leaves keep of the light
  /// is kept by both.
  void _occlude(
    gpu.HostBuffer host,
    PaperFrame frame,
    SheetGrid grid,
    SheetVertices vertices,
    _Targets targets,
    int index,
    List<double> size,
  ) {
    final sheet = frame.sheets[index];
    final shape = outline(frame, sheet.positions);
    final key = RitoPaperLight.keyDirection;
    var pass = passInto(targets.blockers);
    final cast = _programs.cast
      ..set('uSize', size)
      ..set('uEye', [frame.eye])
      ..set('uCast', [-key[0] / key[2], -key[1] / key[2]])
      ..set('uTallest', [shape.tallest])
      ..set('uPixel', [size[0] / targets.width]);
    plain(pass);
    cast.use(pass, host);
    vertices.bindCast(pass);
    grid
      ..bindIndices(pass, fromBelow: false)
      ..draw(pass);
    submit(pass);
    pass = passInto(targets.dark, keep: true);
    final curl = sheet.curl;
    final occlusion = _programs.occlusion
      ..set('uSize', size)
      ..set('uTallest', [shape.tallest])
      ..set('uKeySize', [RitoPaperLight.keySize])
      ..set('uKeyShare', [RitoPaperLight.keyShare])
      ..set('uThrough', [RitoPaperLight.paperThrough])
      ..set('uHandedBack', [RitoPaperLight.handedBack])
      ..set('uSpine', [frame.spine])
      ..set('uSpineAt', [_sides.edge])
      ..set('uBeside', [_sides.left, _sides.right])
      ..set('uRoll', [
        curl?.dx ?? 0,
        curl?.dy ?? 0,
        curl?.at ?? 0,
        curl?.radius ?? -1,
      ])
      ..set('uGutter', [_gutter * (size[0] - frame.spine)])
      ..set('uLight', key)
      ..set('uFlip', _flip);
    occlusion.fragmentBlock.setVec3Array('uProfile', shape.profile);
    plain(pass);
    pass
      ..setColorBlendEnable(true)
      ..setColorBlendEquation(
        gpu.ColorBlendEquation(
          destinationColorBlendFactor: gpu.BlendFactor.zero,
        ),
      );
    occlusion.use(pass, host);
    _quad.bind(pass);
    pass
      ..bindTexture(
        occlusion.sampler('uBlockers'),
        targets.blockers,
        sampler: linearSampler,
      )
      ..bindTexture(
        occlusion.sampler('uCover'),
        targets.cover,
        sampler: linearSampler,
      );
    _quad.draw(pass);
    submit(pass);
  }

  void _blur(
    gpu.HostBuffer host,
    gpu.Texture from,
    gpu.Texture to,
    List<double> step,
  ) {
    final pass = passInto(to);
    final blur = _programs.blur
      ..set('uSpineAt', [_sides.edge])
      ..set('uBeside', [_sides.left, _sides.right])
      ..set('uStep', step)
      ..set('uFlip', _flip);
    plain(pass);
    blur.use(pass, host);
    _quad.bind(pass);
    pass..bindTexture(blur.sampler('uSource'), from, sampler: linearSampler);
    _quad.draw(pass);
    submit(pass);
  }

  /// Lays the darkness worked out over the pages drawn so far in [pass]:
  /// over them all, whatever their depth, writing none.
  void lay(gpu.RenderPass pass, gpu.HostBuffer host) {
    final dark = _targets!.dark;
    final lay = _programs.lay
      ..set('uSpineAt', [_sides.spine])
      ..set('uBeside', [_sides.left, _sides.right])
      ..set('uStrength', [1])
      ..set('uFlip', _flip);
    plain(pass);
    pass
      ..setDepthWriteEnable(false)
      ..setDepthCompareOperation(gpu.CompareFunction.always)
      ..setColorBlendEnable(true)
      ..setColorBlendEquation(gpu.ColorBlendEquation());
    lay.use(pass, host);
    _quad.bind(pass);
    pass..bindTexture(lay.sampler('uSource'), dark, sampler: linearSampler);
    _quad.draw(pass);
  }
}
