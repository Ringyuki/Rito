import 'dart:math' as math;
import 'package:flutter_gpu/gpu.dart' as gpu;

import 'passes.dart';
import 'programs.dart';

/// How a page with its mipmaps is read: linearly between the two copies
/// nearest the pixel's size on it, up to eight times along the way it is
/// squeezed (kit `gl.ts`: `LINEAR_MIPMAP_LINEAR`, anisotropy 8).
final gpu.SamplerOptions mipmappedSampler = gpu.SamplerOptions(
  minFilter: gpu.MinMagFilter.linear,
  magFilter: gpu.MinMagFilter.linear,
  mipFilter: gpu.MipFilter.linear,
  maxAnisotropy: 8,
);

final gpu.SamplerOptions _nearest = gpu.SamplerOptions();

/// A page made ready to be turned as the web makes one (kit `gl.ts`
/// `copyTurned`): copied into a texture of its own, then its mipmaps made,
/// each copy half the size of the one before, every texel the mean of the
/// four it covers, as `generateMipmap` makes them. A pass cannot read the
/// texture it renders into, so each smaller copy is first made in a texture
/// of that size and then copied into its level.
final class PageMips {
  PageMips(this._programs, this._quad, List<double> flip)
    : _flip = _uniforms(_programs.copy, flip);

  final PaperPrograms _programs;
  final Quad _quad;

  /// The copy program's uniforms, which never change: how the backend
  /// stores a rendered texture's rows.
  final gpu.BufferView _flip;

  /// One texture for each size a smaller copy is made at, used again for
  /// every page.
  final _steps = <(int, int), gpu.Texture>{};

  static gpu.BufferView _uniforms(Program copy, List<double> flip) {
    copy.fragmentBlock.set('uFlip', flip);
    final data = copy.fragmentBlock.data;
    final buffer = gpu.gpuContext.createDeviceBufferWithCopy(data);
    return gpu.BufferView(
      buffer,
      offsetInBytes: 0,
      lengthInBytes: data.lengthInBytes,
    );
  }

  /// [page] with its mipmaps, in a texture of its own.
  gpu.Texture of(gpu.Texture page) {
    final levels = gpu.Texture.fullMipCount(page.width, page.height);
    final mipped = gpu.gpuContext.createTexture(
      gpu.StorageMode.devicePrivate,
      page.width,
      page.height,
      mipLevelCount: levels,
    );
    _copy(page, mipped, 0, _nearest);
    var from = page;
    var width = page.width;
    var height = page.height;
    for (var level = 1; level < levels; level += 1) {
      width = math.max(1, width >> 1);
      height = math.max(1, height >> 1);
      final step = _steps.putIfAbsent(
        (width, height),
        () => gpu.gpuContext.createTexture(
          gpu.StorageMode.devicePrivate,
          width,
          height,
        ),
      );
      _copy(from, step, 0, linearSampler);
      _copy(step, mipped, level, _nearest);
      from = step;
    }
    return mipped;
  }

  /// Draws [from] over level [level] of [to], upright, read through
  /// [sampler]; in a command buffer of its own, as a pass that reads what
  /// another pass of its command buffer rendered faults on Impeller's Metal
  /// backend (3.47 still).
  void _copy(
    gpu.Texture from,
    gpu.Texture to,
    int level,
    gpu.SamplerOptions sampler,
  ) {
    final copy = _programs.copy;
    final commands = gpu.gpuContext.createCommandBuffer();
    final pass = commands.createRenderPass(
      gpu.RenderTarget.singleColor(
        gpu.ColorAttachment(texture: to, mipLevel: level),
      ),
    );
    plain(pass);
    pass
      ..bindPipeline(copy.pipeline)
      ..bindUniform(copy.fragment.getUniformSlot('FragmentInfo'), _flip)
      ..bindTexture(copy.sampler('uSource'), from, sampler: sampler);
    _quad
      ..bind(pass)
      ..draw(pass);
    commands.submit();
  }
}
