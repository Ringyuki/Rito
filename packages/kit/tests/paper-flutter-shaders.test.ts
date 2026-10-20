/**
 * Flutter draws the paper turn with the web's shaders, restated for
 * Impeller (`helpers/flutter-shaders.ts`): what rito_flutter compiles must
 * be what the web's shaders make now. `RITO_EMIT_SHADERS=1` writes it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLUTTER_PROBES,
  FLUTTER_SHADERS,
  fileOf,
  flutterLight,
  flutterShader,
  flutterShaderBundle,
} from './helpers/flutter-shaders';

const FLUTTER = join(import.meta.dirname, '../../rito_flutter');
const SHADERS = 'shaders/paper';
const emitting = process.env['RITO_EMIT_SHADERS'] === '1';

const files: Record<string, string> = {
  [`${SHADERS}/paper.shaderbundle.json`]: flutterShaderBundle(SHADERS),
  'lib/src/turn/paper/light.dart': flutterLight(),
  ...Object.fromEntries(
    FLUTTER_SHADERS.map((entry) => [`${SHADERS}/${fileOf(entry)}`, flutterShader(entry)]),
  ),
  ...Object.fromEntries(
    FLUTTER_PROBES.map((probe) => [
      `${SHADERS}/${fileOf({ name: probe.name, stage: 'fragment' })}`,
      probe.text,
    ]),
  ),
};

describe('the paper turn as Flutter draws it', () => {
  it('is drawn with the shaders and light the web draws with', () => {
    for (const [file, text] of Object.entries(files)) {
      const path = join(FLUTTER, file);
      if (emitting) {
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, text);
      }
      expect(existsSync(path), `${file} is missing; emit it`).toBe(true);
      expect(readFileSync(path, 'utf8'), `${file} differs from what the web's make`).toBe(text);
    }
  });
});
