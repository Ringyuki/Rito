import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(import.meta.dirname, '../..');
const WORKSPACE_ROOT = join(PACKAGE_ROOT, '../..');
const SCRIPT = join(PACKAGE_ROOT, 'scripts/render-diagnostic-case.mjs');
const PACKAGE_JSON = join(PACKAGE_ROOT, 'package.json');
const WORKSPACE_PACKAGE_JSON = join(WORKSPACE_ROOT, 'package.json');

describe('render diagnostic script', () => {
  it('drives the production reader entry against the browser XHTML capture', () => {
    const source = read(SCRIPT);

    expect(source).toContain("['production', import('/dist/index.mjs')]");
    expect(source).toContain("process.env.RITO_DIAG_ENGINE || 'production'");
    expect(source).toContain('captureBrowserReference');
    expect(source).not.toContain('reference-dist');
    expect(source).not.toContain("value === 'both'");
  });

  it('exposes workspace and package diagnostic commands without a second engine', () => {
    const packageJson = readPackageJson(PACKAGE_JSON);
    const workspaceJson = readPackageJson(WORKSPACE_PACKAGE_JSON);

    expect(packageJson.scripts['diagnose:render']).toContain('render-diagnostic-case.mjs');
    expect(workspaceJson.scripts['diagnose:render']).toContain('render-diagnostic-case.mjs');
    expect(packageJson.scripts['diagnose:reader-parity']).toBeUndefined();
    expect(workspaceJson.scripts['diagnose:reader-parity']).toBeUndefined();
    expect(packageJson.scripts['build:reference']).toBeUndefined();
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
