import 'dart:typed_data';

import 'package:flutter_gpu/gpu.dart' as gpu;

/// A stage's uniform block, written by member name at the offsets the
/// compiled shader reports. A name the stage does not declare is skipped:
/// a value both stages of the web's program share is written to both.
final class UniformBlock {
  UniformBlock(this.slot) : data = ByteData(slot.sizeInBytes ?? 0);

  final gpu.UniformSlot slot;
  final ByteData data;

  void set(String name, List<double> values) {
    final offset = slot.getMemberOffsetInBytes(name);
    if (offset == null) return;
    for (var i = 0; i < values.length; i += 1) {
      data.setFloat32(offset + i * 4, values[i], Endian.little);
    }
  }

  /// An array of vec3, each element 16 bytes apart as std140 lays it out.
  void setVec3Array(String name, Float32List values) {
    final offset = slot.getMemberOffsetInBytes(name);
    if (offset == null) return;
    for (var element = 0; element * 3 < values.length; element += 1) {
      for (var c = 0; c < 3; c += 1) {
        data.setFloat32(
          offset + element * 16 + c * 4,
          values[element * 3 + c],
          Endian.little,
        );
      }
    }
  }

  void bind(gpu.RenderPass pass, gpu.HostBuffer host) {
    if (data.lengthInBytes > 0) pass.bindUniform(slot, host.emplace(data));
  }
}
