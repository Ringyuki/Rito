import 'artifact_models.dart';
import 'binary_reader.dart';

RitoLocator readRitoLocator(RitoBinaryReader reader) {
  final record = reader.record('locator');
  final locator = RitoLocator(
    href: record.string('locator href'),
    anchorId: record.option(
      'locator anchor',
      () => record.string('locator anchor'),
    ),
    sourcePoint: record.option(
      'source point',
      () => readRitoSourcePoint(record),
    ),
    sourceRange: record.option(
      'source range',
      () => _readRitoSourceRange(record),
    ),
    progression: record.option(
      'locator progression',
      () => record.float64('locator progression'),
    ),
  );
  record.finish('locator');
  return locator;
}

RitoSourcePoint readRitoSourcePoint(RitoBinaryReader reader) {
  final record = reader.record('source point');
  final count = record.count('source point path');
  final point = RitoSourcePoint(
    nodePath: <int>[
      for (var index = 0; index < count; index += 1)
        record.uint32('source point path'),
    ],
    textOffset: record.uint64('source text offset'),
  );
  record.finish('source point');
  return point;
}

RitoSourceRange _readRitoSourceRange(RitoBinaryReader reader) {
  final record = reader.record('source range');
  final range = RitoSourceRange(
    start: readRitoSourcePoint(record),
    end: readRitoSourcePoint(record),
  );
  record.finish('source range');
  return range;
}
