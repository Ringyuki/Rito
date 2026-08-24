import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(import.meta.dirname, '../..');
const WORKSPACE_ROOT = join(PACKAGE_ROOT, '../..');
const SCRIPT = join(PACKAGE_ROOT, 'scripts/render-diagnostic-case.mjs');
const PACKAGE_JSON = join(PACKAGE_ROOT, 'package.json');
const WORKSPACE_PACKAGE_JSON = join(WORKSPACE_ROOT, 'package.json');

describe('render diagnostic script', () => {
  it('loads production and reference reader entries for parity diagnostics', () => {
    const source = read(SCRIPT);

    expect(source).toContain("['production', import('/dist/index.mjs')]");
    expect(source).toContain("['reference', import('/reference-dist/tooling/web.mjs')]");
    expect(source).toContain("process.env.RITO_DIAG_ENGINE || 'production'");
    expect(source).toContain("value === 'both'");
    expect(source).toContain('writeParityArtifacts');
  });

  it('exposes workspace and package reader-parity commands', () => {
    const packageJson = readPackageJson(PACKAGE_JSON);
    const workspaceJson = readPackageJson(WORKSPACE_PACKAGE_JSON);

    expect(packageJson.scripts['diagnose:reader-parity']).toContain('RITO_DIAG_ENGINE=both');
    expect(workspaceJson.scripts['diagnose:reader-parity']).toContain('RITO_DIAG_ENGINE=both');
  });
});

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function readPackageJson(path: string): { readonly scripts: Record<string, string> } {
  const parsed: unknown = JSON.parse(read(path));
  if (!isPackageJsonRecord(parsed)) throw new Error(`${path} is not a package.json record`);
  return parsed;
}

function isPackageJsonRecord(
  value: unknown,
): value is { readonly scripts: Record<string, string> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const scripts = (value as { readonly scripts?: unknown }).scripts;
  return typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts);
}
