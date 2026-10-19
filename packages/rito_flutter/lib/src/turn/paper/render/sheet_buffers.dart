import 'dart:typed_data';

import 'package:flutter_gpu/gpu.dart' as gpu;

import 'paper_frame.dart';

/// The grid a sheet is drawn with: where each point is on the sheet, and
/// the triangles between the points in both orders (mesh.ts `sheetGrid`).
final class SheetGrid {
  SheetGrid(this.columns, this.rows) : uvs = Float32List(columns * rows * 2) {
    for (var row = 0; row < rows; row += 1) {
      for (var column = 0; column < columns; column += 1) {
        final at = row * columns + column;
        uvs[at * 2] = column / (columns - 1);
        uvs[at * 2 + 1] = row / (rows - 1);
      }
    }
    final down = <int>[];
    final up = <int>[];
    for (var row = 0; row + 1 < rows; row += 1) {
      down.addAll(_rowOf(row));
      up.addAll(_rowOf(rows - 2 - row));
    }
    indexCount = down.length;
    final both = Uint16List.fromList([...down, ...up]);
    indices = gpu.gpuContext.createDeviceBufferWithCopy(
      ByteData.sublistView(both),
    );
  }

  final int columns;
  final int rows;
  final Float32List uvs;
  late final int indexCount;
  late final gpu.DeviceBuffer indices;

  List<int> _rowOf(int row) {
    final triangles = <int>[];
    for (var column = 0; column + 1 < columns; column += 1) {
      final at = row * columns + column;
      triangles.addAll([
        at,
        at + columns,
        at + 1,
        at + 1,
        at + columns,
        at + columns + 1,
      ]);
    }
    return triangles;
  }

  /// Binds the triangles from the top row down, or from the bottom up.
  void bindIndices(gpu.RenderPass pass, {required bool fromBelow}) {
    pass.bindIndexBuffer(
      gpu.BufferView(
        indices,
        offsetInBytes: fromBelow ? indexCount * 2 : 0,
        lengthInBytes: indexCount * 2,
      ),
      gpu.IndexType.int16,
      indexCount,
    );
  }
}

/// A sheet's points as each program takes them, interleaved: the sheet's
/// (position, normal, uv), the cover's (position, uv) and the cast's
/// (position). Kept for its place in the frame and written over.
final class SheetVertices {
  SheetVertices(int points)
    : points = points,
      sheet = Float32List(points * 8),
      cover = Float32List(points * 5),
      cast = Float32List(points * 3),
      sheetBuffer = gpu.gpuContext.createDeviceBuffer(
        gpu.StorageMode.hostVisible,
        points * 8 * 4,
      ),
      coverBuffer = gpu.gpuContext.createDeviceBuffer(
        gpu.StorageMode.hostVisible,
        points * 5 * 4,
      ),
      castBuffer = gpu.gpuContext.createDeviceBuffer(
        gpu.StorageMode.hostVisible,
        points * 3 * 4,
      );

  final int points;
  final Float32List sheet;
  final Float32List cover;
  final Float32List cast;
  final gpu.DeviceBuffer sheetBuffer;
  final gpu.DeviceBuffer coverBuffer;
  final gpu.DeviceBuffer castBuffer;

  void write(PaperSheet from, SheetGrid grid, {required bool standing}) {
    final p = from.positions;
    final n = from.normals;
    final uv = grid.uvs;
    for (var i = 0; i < points; i += 1) {
      final s = i * 8;
      sheet[s] = p[i * 3];
      sheet[s + 1] = p[i * 3 + 1];
      sheet[s + 2] = p[i * 3 + 2];
      sheet[s + 3] = n[i * 3];
      sheet[s + 4] = n[i * 3 + 1];
      sheet[s + 5] = n[i * 3 + 2];
      sheet[s + 6] = uv[i * 2];
      sheet[s + 7] = uv[i * 2 + 1];
    }
    sheetBuffer.overwrite(ByteData.sublistView(sheet));
    if (!standing) return;
    for (var i = 0; i < points; i += 1) {
      final c = i * 5;
      cover[c] = p[i * 3];
      cover[c + 1] = p[i * 3 + 1];
      cover[c + 2] = p[i * 3 + 2];
      cover[c + 3] = uv[i * 2];
      cover[c + 4] = uv[i * 2 + 1];
    }
    coverBuffer.overwrite(ByteData.sublistView(cover));
    castBuffer.overwrite(ByteData.sublistView(p));
  }

  void bindSheet(gpu.RenderPass pass) => _bind(pass, sheetBuffer);
  void bindCover(gpu.RenderPass pass) => _bind(pass, coverBuffer);
  void bindCast(gpu.RenderPass pass) => _bind(pass, castBuffer);

  void _bind(gpu.RenderPass pass, gpu.DeviceBuffer buffer) =>
      pass.bindVertexBuffer(
        gpu.BufferView(
          buffer,
          offsetInBytes: 0,
          lengthInBytes: buffer.sizeInBytes,
        ),
        points,
      );
}
