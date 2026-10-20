import 'package:flutter_gpu/gpu.dart' as gpu;

import 'uniform_block.dart';

/// A compiled pair of the paper turn's shaders, with its uniform blocks.
final class Program {
  Program(gpu.ShaderLibrary library, String vertex, String fragment)
    : vertex = library[vertex]!,
      fragment = library[fragment]! {
    pipeline = gpu.gpuContext.createRenderPipeline(this.vertex, this.fragment);
    vertexBlock = UniformBlock(this.vertex.getUniformSlot('VertexInfo'));
    fragmentBlock = UniformBlock(this.fragment.getUniformSlot('FragmentInfo'));
  }

  final gpu.Shader vertex;
  final gpu.Shader fragment;
  late final gpu.RenderPipeline pipeline;
  late final UniformBlock vertexBlock;
  late final UniformBlock fragmentBlock;

  /// Writes a value to whichever stages declare it.
  void set(String name, List<double> values) {
    vertexBlock.set(name, values);
    fragmentBlock.set(name, values);
  }

  gpu.UniformSlot sampler(String name) => fragment.getUniformSlot(name);

  /// Binds the pipeline and both blocks as they now are.
  void use(gpu.RenderPass pass, gpu.HostBuffer host) {
    pass.bindPipeline(pipeline);
    vertexBlock.bind(pass, host);
    fragmentBlock.bind(pass, host);
  }
}

/// Every program the paper turn draws with. With [mipmapped] a sheet reads
/// its pages from their mipmaps, as the web does; without, over each pixel's
/// footprint on them.
final class PaperPrograms {
  PaperPrograms(
    gpu.ShaderLibrary library, {
    required bool softened,
    required bool mipmapped,
  }) : sheet = Program(
         library,
         'SheetVertex',
         'Sheet${softened ? 'Softened' : ''}'
             '${mipmapped ? '' : 'Footprint'}Fragment',
       ),
       cast = Program(library, 'CastVertex', 'CastFragment'),
       cover = Program(library, 'CoverVertex', 'CoverFragment'),
       occlusion = Program(library, 'QuadVertex', 'OcclusionFragment'),
       blur = Program(library, 'QuadVertex', 'BlurFragment'),
       lay = Program(library, 'QuadVertex', 'LayFragment'),
       rowsWritten = Program(library, 'QuadVertex', 'RowsWrittenFragment'),
       rowsRead = Program(library, 'QuadVertex', 'RowsReadFragment'),
       copy = Program(library, 'QuadVertex', 'CopyFragment');

  final Program sheet;
  final Program cast;
  final Program cover;
  final Program occlusion;
  final Program blur;
  final Program lay;
  final Program rowsWritten;
  final Program rowsRead;
  final Program copy;
}
