import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The snap-back hunt cost days because the visible spread had anonymous
// writers scattered across the controller. These scans keep both
// navigation state fields behind their single named writer.

const SRC_ROOT = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function filesAssigning(pattern: RegExp, subtree = ''): string[] {
  return sourceFiles(join(SRC_ROOT, subtree))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SRC_ROOT, path));
}

describe('navigation write authority', () => {
  it('only commitCurrentSpread writes internals.currentSpread', () => {
    expect(filesAssigning(/\.currentSpread\s*=(?!=)/)).toEqual([
      'controller/core/current-spread.ts',
    ]);
  });

  it('only the machine writes its queued and foreground slots', () => {
    const scope = 'controller/navigation';
    expect(filesAssigning(/\.queued\s*=(?!=)/, scope)).toEqual([
      'controller/navigation/machine.ts',
    ]);
    expect(filesAssigning(/\.foreground\s*=(?!=)/, scope)).toEqual([
      'controller/navigation/machine.ts',
    ]);
  });

  it('only publishSpreadChange emits the spreadChange event', () => {
    expect(filesAssigning(/emit\(\s*'spreadChange'/)).toEqual(['controller/core/spread-change.ts']);
  });
});
