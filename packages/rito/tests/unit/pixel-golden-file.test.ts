import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearPixelGoldenPrimaryFilesInDir } from '../golden-pixel/helpers/pixel-golden-file';

const tempDirs: string[] = [];

describe('pixel golden files', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('preserves alternate baselines when clearing primary update output', async () => {
    const dir = await createTempDir();

    await Promise.all([
      writeFile(resolve(dir, 'summary.json'), '{}\n'),
      writeFile(resolve(dir, 'spread-0000.png'), 'primary 0'),
      writeFile(resolve(dir, 'spread-0000.alt-macos-14-arm64-ci.png'), 'alt 0'),
      writeFile(resolve(dir, 'spread-0001.png'), 'primary 1'),
      writeFile(resolve(dir, 'spread-0001.alt-linux-ci.png'), 'alt 1'),
      writeFile(resolve(dir, 'notes.txt'), 'manual note'),
    ]);

    await clearPixelGoldenPrimaryFilesInDir(dir);

    expect(await sortedFiles(dir)).toEqual([
      'notes.txt',
      'spread-0000.alt-macos-14-arm64-ci.png',
      'spread-0001.alt-linux-ci.png',
    ]);
    await expect(
      readFile(resolve(dir, 'spread-0000.alt-macos-14-arm64-ci.png'), 'utf8'),
    ).resolves.toBe('alt 0');
  });

  it('ignores missing run directories', async () => {
    const dir = await createTempDir();
    await rm(dir, { recursive: true, force: true });

    await expect(clearPixelGoldenPrimaryFilesInDir(dir)).resolves.toBeUndefined();
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rito-pixel-golden-'));
  tempDirs.push(dir);
  return dir;
}

async function sortedFiles(dir: string): Promise<readonly string[]> {
  return (await readdir(dir)).sort();
}
