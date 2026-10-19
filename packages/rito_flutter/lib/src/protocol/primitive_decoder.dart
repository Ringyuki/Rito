part of 'display_decoder.dart';

/// Strict little-endian decoder for `RITODL1` format version 4, the
/// device-resolved primitive list the engine paints every frame as. Its
/// text runs index into tables after the primitives: their clusters are
/// read in place, their text and paints decoded once.
final class RitoPrimitiveListDecoder {
  const RitoPrimitiveListDecoder();

  /// Mirrors `READER_PRIMITIVE_LIST_FORMAT_VERSION` in
  /// crates/rito-core/src/render/commands/reader_wire.rs.
  static const int formatVersion = 4;
  static final List<int> _magic = ascii.encode('RITODL1');

  RitoPrimitiveList decode(Uint8List bytes) {
    if (bytes.length > ritoMaxWireBytes) {
      throw const FormatException('RITODL1 exceeds the byte limit.');
    }
    final reader = RitoBinaryReader(bytes);
    reader.expectMagic(_magic, 'primitive list magic');
    final version = reader.uint32('primitive list version');
    if (version != formatVersion) {
      reader.fail('unsupported primitive list version: $version');
    }
    final ratio = reader.float64('primitive list ratio');
    if (ratio <= 0) {
      reader.fail('primitive list ratio must be positive');
    }
    final count = reader.count('primitive count');
    final commands = <RitoPrimitive>[];
    final runs = <(int, _RitoTextReference)>[];
    for (var index = 0; index < count; index += 1) {
      commands.add(_primitive(reader, runs, index));
    }
    final tables = _readTextTables(reader);
    for (final (index, run) in runs) {
      final resolved = _resolveTextRun(reader, run, tables);
      commands[index] = switch (resolved) {
        RitoPaintText() => RitoPrimitiveText(resolved),
        RitoPaintRuby() => RitoPrimitiveRuby(resolved),
      };
    }
    reader.finish('primitive list');
    return RitoPrimitiveList(
      formatVersion: version,
      ratio: ratio,
      commands: commands,
    );
  }

  /// The primitive at [index]; a text or ruby run joins [runs] and stands
  /// as a placeholder until the tables resolve it.
  RitoPrimitive _primitive(
    RitoBinaryReader reader,
    List<(int, _RitoTextReference)> runs,
    int index,
  ) {
    final opcode = reader.uint16('primitive opcode');
    return switch (opcode) {
      1 => const RitoPrimitivePushState(),
      2 => const RitoPrimitivePopState(),
      3 => RitoPrimitiveTranslate(
        dx: reader.float64('translate dx'),
        dy: reader.float64('translate dy'),
      ),
      4 => RitoPrimitiveOpacity(reader.float64('opacity')),
      5 => _transform(reader),
      6 => RitoPrimitiveClipPath(_path(reader)),
      7 => _fillRect(reader),
      8 => _fillPath(reader),
      9 => RitoPrimitiveStrokePath(
        path: _path(reader),
        width: reader.float64('stroke width'),
        color: reader.readColor(),
        cap: _wireEnum(reader, 'stroke cap', const <RitoStrokeCap>[
          RitoStrokeCap.butt,
          RitoStrokeCap.round,
        ]),
        dash: reader.option(
          'stroke dash',
          () => RitoDashPattern(
            on: reader.float64('stroke dash on'),
            off: reader.float64('stroke dash off'),
          ),
        ),
      ),
      10 => RitoPrimitiveShadow(
        shape: _path(reader),
        sigma: reader.float64('shadow sigma'),
        offset: _point(reader, 'shadow offset'),
        color: reader.readColor(),
        clipOut: reader.option('shadow clip', () => _path(reader)),
      ),
      11 => RitoPrimitiveDrawImage(
        src: reader.string('image source'),
        dest: reader.readDisplayRect('image dest'),
        sourceRect: reader.option(
          'image source rect',
          () => reader.readDisplayRect('image source rect'),
        ),
        tiles: reader.option('image tiles', () => _tiles(reader)),
      ),
      12 || 13 => _textPlaceholder(
        runs,
        index,
        _readTextReference(reader, ruby: opcode == 13),
      ),
      14 => _imageFallback(reader),
      _ => reader.fail('unknown primitive opcode: $opcode'),
    };
  }

  RitoPrimitive _textPlaceholder(
    List<(int, _RitoTextReference)> runs,
    int index,
    _RitoTextReference run,
  ) {
    runs.add((index, run));
    return const RitoPrimitivePushState();
  }

  RitoPrimitiveImageFallback _imageFallback(RitoBinaryReader reader) {
    final src = reader.string('image fallback source');
    final state = _wireEnum(
      reader,
      'image fallback state',
      const <RitoImageFallbackState>[
        RitoImageFallbackState.loading,
        RitoImageFallbackState.broken,
      ],
    );
    final block = reader.readDisplayRect('image fallback block');
    final blockInk = reader.float64('image fallback block ink');
    final iconInk = reader.float64('image fallback icon ink');
    final count = reader.count('image fallback piece count');
    return RitoPrimitiveImageFallback(
      src: src,
      state: state,
      block: block,
      blockInk: blockInk,
      iconInk: iconInk,
      pieces: <RitoIconPiece>[
        for (var index = 0; index < count; index += 1)
          RitoIconPiece(
            offset: _point(reader, 'icon piece offset'),
            clip: reader.option('icon piece clip', () => _path(reader)),
            path: _path(reader),
          ),
      ],
    );
  }

  RitoPrimitiveFillRect _fillRect(RitoBinaryReader reader) {
    final rect = reader.readDisplayRect('fill rect');
    final color = reader.readColor();
    final (ground, groundRect) = _ground(reader);
    return RitoPrimitiveFillRect(
      rect: rect,
      color: color,
      ground: ground,
      groundRect: groundRect,
    );
  }

  RitoPrimitiveFillPath _fillPath(RitoBinaryReader reader) {
    final path = _path(reader);
    final rule = _wireEnum(reader, 'fill rule', const <RitoFillRule>[
      RitoFillRule.nonZero,
      RitoFillRule.evenOdd,
    ]);
    final color = reader.readColor();
    final (ground, groundRect) = _ground(reader);
    return RitoPrimitiveFillPath(
      path: path,
      rule: rule,
      color: color,
      ground: ground,
      groundRect: groundRect,
    );
  }

  /// A fill's declared ground; a block ground carries the unsnapped box
  /// it covers.
  (RitoFillGround, RitoDisplayRect?) _ground(RitoBinaryReader reader) {
    final ground = _wireEnum(reader, 'fill ground', const <RitoFillGround>[
      RitoFillGround.none,
      RitoFillGround.page,
      RitoFillGround.block,
    ]);
    if (identical(ground, RitoFillGround.block)) {
      return (ground, reader.readDisplayRect('ground rect'));
    }
    return (ground, null);
  }

  RitoPrimitiveTransform _transform(RitoBinaryReader reader) {
    final origin = _point(reader, 'transform origin');
    final count = reader.count('transform count');
    final transforms = <RitoDeviceTransform>[];
    for (var index = 0; index < count; index += 1) {
      final tag = reader.uint8('transform tag');
      transforms.add(switch (tag) {
        1 => RitoDeviceRotate(reader.float64('transform rotation')),
        2 => RitoDeviceScale(
          sx: reader.float64('transform scale x'),
          sy: reader.float64('transform scale y'),
        ),
        3 => RitoDeviceTranslate(
          dx: reader.float64('transform translation x'),
          dy: reader.float64('transform translation y'),
        ),
        _ => reader.fail('unknown transform tag: $tag'),
      });
    }
    return RitoPrimitiveTransform(origin: origin, transforms: transforms);
  }

  RitoDevicePath _path(RitoBinaryReader reader) {
    final count = reader.count('path op count');
    final ops = <RitoPathOp>[];
    for (var index = 0; index < count; index += 1) {
      final tag = reader.uint8('path op tag');
      ops.add(switch (tag) {
        1 => RitoPathMoveTo(
          x: reader.float64('path x'),
          y: reader.float64('path y'),
        ),
        2 => RitoPathLineTo(
          x: reader.float64('path x'),
          y: reader.float64('path y'),
        ),
        3 => RitoPathArc(
          cx: reader.float64('arc center x'),
          cy: reader.float64('arc center y'),
          rx: reader.float64('arc radius x'),
          ry: reader.float64('arc radius y'),
          start: reader.float64('arc start'),
          sweep: reader.float64('arc sweep'),
        ),
        4 => RitoPathEllipse(
          cx: reader.float64('ellipse center x'),
          cy: reader.float64('ellipse center y'),
          rx: reader.float64('ellipse radius x'),
          ry: reader.float64('ellipse radius y'),
        ),
        5 => RitoPathRect(reader.readDisplayRect('path rect')),
        6 => const RitoPathClose(),
        _ => reader.fail('unknown path op tag: $tag'),
      });
    }
    return RitoDevicePath(ops);
  }

  RitoTilePlan _tiles(RitoBinaryReader reader) {
    return RitoTilePlan(
      origin: _point(reader, 'tile origin'),
      stepX: reader.float64('tile step x'),
      stepY: reader.float64('tile step y'),
      columns: reader.uint32('tile columns'),
      rows: reader.uint32('tile rows'),
    );
  }

  RitoDisplayPoint _point(RitoBinaryReader reader, String field) {
    return RitoDisplayPoint(
      x: reader.float64('$field x'),
      y: reader.float64('$field y'),
    );
  }
}
