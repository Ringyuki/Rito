export const FRAME_COMMAND_BUFFER_MAGIC = 'RITOFCB2';
export const FRAME_COMMAND_BUFFER_VERSION = 2;
export const FRAME_COMMAND_HEADER_BYTES = 16;
export const FRAME_COMMAND_RECORD_BYTES = 32;
export const NO_STRING_INDEX = 0xffffffff;

export const COMMAND_KINDS = {
  1: 'pushState',
  2: 'popState',
  3: 'translate',
  4: 'opacity',
  5: 'transform',
  6: 'clipRect',
  7: 'paintPage',
  8: 'paintBlock',
  9: 'paintText',
  10: 'paintRuby',
  11: 'paintImage',
  12: 'paintHorizontalRule',
};

export const RECORD_STAT_KEYS = [
  'geometryRecords',
  'paintRecords',
  'payloadRecords',
  'primaryStringRecords',
  'secondaryStringRecords',
];
