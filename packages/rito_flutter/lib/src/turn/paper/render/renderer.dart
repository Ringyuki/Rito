import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_gpu/gpu.dart' as gpu;
import 'package:vector_math/vector_math.dart' as vm;

import '../light.dart';
import 'paper_frame.dart';
import 'passes.dart';
import 'programs.dart';
import 'shadow_pass.dart';
import 'sheet_buffers.dart';

/// At two device pixels or more to a logical pixel the steps along an
/// edge are too small to see; there the edge is softened in the shader
/// instead of the frame being drawn at four points a pixel.
const double _fine = 2;

/// How many frames are kept: a frame is shown by the raster thread after
/// the next has been asked for, so its texture and buffers are not drawn
/// over until two more have been.
const int _kept = 3;

/// What one frame of the ring holds: where it is drawn and the sheets' points.
final class _Slot {
  gpu.Texture? color;
  final List<SheetVertices> vertices = [];
}

/// The web paper turn's renderer (kit `renderer.ts`, `draw-sheet.ts`,
/// `shadow.ts`) on flutter_gpu: every shadow pass first, then the frame in
/// one pass — the sheets lying on the pages, the shadows laid over them,
/// the sheets standing off them.
final class PaperRenderer {
  PaperRenderer._(
    this._programs,
    this._shadow,
    this._bare, {
    required this.softened,
  });

  /// Readies the programs for a frame drawn at [pixelRatio] device pixels
  /// to a logical one, and learns how the backend stores a texture's rows.
  static Future<PaperRenderer> start(
    gpu.ShaderLibrary library, {
    required double pixelRatio,
  }) async {
    final context = gpu.gpuContext;
    final softened = pixelRatio >= _fine || !context.doesSupportOffscreenMSAA;
    final programs = PaperPrograms(library, softened: softened);
    final quad = Quad();
    final flip = await rowsOf(programs, quad);
    final bare = context.createTexture(gpu.StorageMode.hostVisible, 1, 1)
      ..overwrite(ByteData(4));
    return PaperRenderer._(
      programs,
      ShadowPass(programs, quad, flip),
      bare,
      softened: softened,
    );
  }

  final PaperPrograms _programs;
  final ShadowPass _shadow;

  /// What a face with no page shows: nothing, the paper's own colour.
  final gpu.Texture _bare;

  /// Whether a standing sheet's edge is softened where it is drawn rather
  /// than the frame multisampled.
  final bool softened;
  final _grids = <String, SheetGrid>{};
  final _slots = List.generate(_kept, (_) => _Slot());
  final _host = gpu.gpuContext.createHostBuffer();
  var _frames = 0;
  gpu.Texture? _depth;
  gpu.Texture? _samples;

  /// Draws a frame; its texture is not drawn over for two frames more.
  gpu.Texture draw(PaperFrame frame) {
    final width = math.max(1, frame.width.round());
    final height = math.max(1, frame.height.round());
    final slot = _slots[_frames % _kept];
    _frames += 1;
    _host.reset();
    final grid = _grids.putIfAbsent(
      '${frame.columns}x${frame.rows}',
      () => SheetGrid(frame.columns, frame.rows),
    );
    final standing = [for (final sheet in frame.sheets) !liesOnThePages(sheet)];
    _write(slot, frame, grid, standing);
    final casters = [
      for (var index = 0; index < frame.sheets.length; index += 1)
        if (standing[index]) index,
    ];
    if (casters.isNotEmpty) {
      _shadow.workOut(
        _host,
        frame,
        grid,
        slot.vertices,
        casters,
        width,
        height,
      );
    }
    final color = slot.color = _sized(slot.color, width, height);
    final commands = gpu.gpuContext.createCommandBuffer();
    final pass = commands.createRenderPass(_target(color, width, height));
    for (var index = 0; index < frame.sheets.length; index += 1) {
      final part = !standing[index]
          ? SheetPart.whole
          : frame.sheets[index].curl != null
          ? SheetPart.lying
          : null;
      if (part != null)
        _sheet(pass, slot, frame, grid, index, part, blend: false);
    }
    if (casters.isNotEmpty) _shadow.lay(pass, _host);
    for (final index in casters) {
      final part = frame.sheets[index].curl != null
          ? SheetPart.lifted
          : SheetPart.whole;
      // An edge softened where it is drawn lets what lies beneath show through it.
      _sheet(pass, slot, frame, grid, index, part, blend: softened);
    }
    commands.submit();
    return color;
  }

  void _write(
    _Slot slot,
    PaperFrame frame,
    SheetGrid grid,
    List<bool> standing,
  ) {
    final points = frame.columns * frame.rows;
    for (var index = 0; index < frame.sheets.length; index += 1) {
      if (slot.vertices.length <= index)
        slot.vertices.add(SheetVertices(points));
      if (slot.vertices[index].points != points) {
        slot.vertices[index] = SheetVertices(points);
      }
      slot.vertices[index].write(
        frame.sheets[index],
        grid,
        standing: standing[index],
      );
    }
  }

  static gpu.Texture _sized(gpu.Texture? kept, int width, int height) =>
      kept != null && kept.width == width && kept.height == height
      ? kept
      : gpu.gpuContext.createTexture(
          gpu.StorageMode.devicePrivate,
          width,
          height,
        );

  /// Where the frame is drawn: [color] itself, or four points a pixel
  /// resolved into it; and a depth buffer to match.
  gpu.RenderTarget _target(gpu.Texture color, int width, int height) {
    final context = gpu.gpuContext;
    final samples = softened ? 1 : 4;
    final depth = _depth;
    if (depth == null || depth.width != width || depth.height != height) {
      _depth = context.createTexture(
        gpu.StorageMode.deviceTransient,
        width,
        height,
        format: context.defaultDepthStencilFormat,
        sampleCount: samples,
      );
      _samples = softened
          ? null
          : context.createTexture(
              gpu.StorageMode.deviceTransient,
              width,
              height,
              sampleCount: samples,
            );
    }
    return gpu.RenderTarget.singleColor(
      gpu.ColorAttachment(
        texture: _samples ?? color,
        resolveTexture: _samples == null ? null : color,
        storeAction: _samples == null
            ? gpu.StoreAction.store
            : gpu.StoreAction.multisampleResolve,
        clearValue: vm.Vector4(0, 0, 0, 0),
      ),
      depthStencilAttachment: gpu.DepthStencilAttachment(
        texture: _depth!,
        depthClearValue: 1,
      ),
    );
  }

  /// Draws one sheet of a frame, or one part of it (kit `drawSheet`).
  void _sheet(
    gpu.RenderPass pass,
    _Slot slot,
    PaperFrame frame,
    SheetGrid grid,
    int index,
    SheetPart part, {
    required bool blend,
  }) {
    final sheet = frame.sheets[index];
    final reach = frame.width - frame.spine;
    final lift = liftOf(frame, index);
    final curl = sheet.curl;
    final program = _programs.sheet
      ..set('uSize', [frame.width, frame.height])
      ..set('uEye', [frame.eye])
      ..set('uDepth', [reach * 1.25])
      ..set('uLift', [lift.lying])
      ..set('uTurnedLift', [lift.turned])
      ..set('uPart', [partOf(part)])
      ..set('uCurl', [
        curl?.dx ?? 0,
        curl?.dy ?? 0,
        curl?.at ?? 0,
        curl?.radius ?? 0,
      ])
      ..set('uShows', [
        curl != null
            ? RitoPaperLight.showsThroughCurled
            : RitoPaperLight.showsThrough,
      ])
      ..set('uSpine', [frame.spine / frame.width])
      ..set('uSheet', [reach / frame.width])
      ..set('uPaper', frame.paper)
      ..set('uLight', RitoPaperLight.keyDirection)
      ..set('uKeyShare', [RitoPaperLight.keyShare])
      ..set('uThrough', [RitoPaperLight.paperThrough])
      ..set('uHandedBack', [RitoPaperLight.handedBack])
      ..set('uHasFront', [sheet.front != null ? 1 : 0])
      ..set('uHasBack', [sheet.back != null ? 1 : 0]);
    plain(pass);
    pass
      ..setWindingOrder(gpu.WindingOrder.counterClockwise)
      ..setDepthWriteEnable(true)
      ..setDepthCompareOperation(gpu.CompareFunction.lessEqual)
      ..setColorBlendEnable(blend);
    if (blend) pass.setColorBlendEquation(gpu.ColorBlendEquation());
    program.use(pass, _host);
    slot.vertices[index].bindSheet(pass);
    pass
      ..bindTexture(
        program.sampler('uFront'),
        sheet.front ?? _bare,
        sampler: linearSampler,
      )
      ..bindTexture(
        program.sampler('uBack'),
        sheet.back ?? _bare,
        sampler: linearSampler,
      );
    grid.bindIndices(pass, fromBelow: fromBelow(sheet, part));
    pass.draw();
  }
}
