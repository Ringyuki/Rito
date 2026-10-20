import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_gpu/gpu.dart' as gpu;
import 'package:vector_math/vector_math.dart' as vm;

import 'programs.dart';

/// How the paper turn reads a texture: linearly, as the web does.
final gpu.SamplerOptions linearSampler = gpu.SamplerOptions(
  minFilter: gpu.MinMagFilter.linear,
  magFilter: gpu.MinMagFilter.linear,
);

final _commands = Expando<gpu.CommandBuffer>();

/// A pass into [target] in a command buffer of its own, submitted by
/// [submit]: a pass that samples what an earlier pass of the same command
/// buffer rendered faults on Impeller's Metal backend.
gpu.RenderPass passInto(gpu.Texture target, {bool keep = false}) {
  final commands = gpu.gpuContext.createCommandBuffer();
  final pass = commands.createRenderPass(
    gpu.RenderTarget.singleColor(
      gpu.ColorAttachment(
        texture: target,
        loadAction: keep ? gpu.LoadAction.load : gpu.LoadAction.clear,
        clearValue: vm.Vector4(0, 0, 0, 0),
      ),
    ),
  );
  _commands[pass] = commands;
  return pass;
}

void submit(gpu.RenderPass pass) => _commands[pass]!.submit();

/// No blending, no culling, and nothing an earlier draw bound but the
/// index buffer, which `clearBindings` keeps: every draw binds its own.
void plain(gpu.RenderPass pass) {
  pass
    ..clearBindings()
    ..setCullMode(gpu.CullMode.none)
    ..setColorBlendEnable(false);
}

/// The two triangles that cover whatever is drawn to, and their own indices.
final class Quad {
  Quad()
    : _corners = gpu.gpuContext.createDeviceBufferWithCopy(
        ByteData.sublistView(
          Float32List.fromList([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
        ),
      ),
      _indices = gpu.gpuContext.createDeviceBufferWithCopy(
        ByteData.sublistView(Uint16List.fromList([0, 1, 2, 3, 4, 5])),
      );

  final gpu.DeviceBuffer _corners;
  final gpu.DeviceBuffer _indices;

  void bind(gpu.RenderPass pass) {
    pass
      ..bindVertexBuffer(
        gpu.BufferView(
          _corners,
          offsetInBytes: 0,
          lengthInBytes: _corners.sizeInBytes,
        ),
      )
      ..bindIndexBuffer(
        gpu.BufferView(
          _indices,
          offsetInBytes: 0,
          lengthInBytes: _indices.sizeInBytes,
        ),
        gpu.IndexType.int16,
      );
  }

  /// Draws both triangles with what is bound.
  void draw(gpu.RenderPass pass) => pass.drawIndexed(6);
}

/// How the backend stores a rendered texture's rows, as the programs
/// reading one take it (`uFlip`): (0, 1) where its first row is the bottom
/// of what was drawn, as GL's is; (1, -1) where it is the top. A quad pass
/// writes where it thinks each row is; a second reads that back where it
/// thinks it is: mirrored, the first row and the last are far apart.
Future<List<double>> rowsOf(PaperPrograms programs, Quad quad) async {
  final context = gpu.gpuContext;
  // Four by four: a texture a texel wide does not read back on every backend.
  final written = context.createTexture(gpu.StorageMode.devicePrivate, 4, 4);
  final apart = context.createTexture(gpu.StorageMode.devicePrivate, 4, 4);
  final host = context.createHostBuffer();
  var pass = passInto(written);
  plain(pass);
  programs.rowsWritten.use(pass, host);
  quad
    ..bind(pass)
    ..draw(pass);
  submit(pass);
  pass = passInto(apart);
  plain(pass);
  programs.rowsRead.use(pass, host);
  quad.bind(pass);
  pass.bindTexture(programs.rowsRead.sampler('uSource'), written);
  quad.draw(pass);
  submit(pass);
  final image = apart.asImage();
  final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  image.dispose();
  final far = math.max(bytes!.getUint8(0), bytes.getUint8(3 * 4 * 4));
  return far < 64 ? const [0, 1] : const [1, -1];
}
