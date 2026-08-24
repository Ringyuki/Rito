import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const READER_TEST_SERVER_PORT = 4173;
export const READER_TEST_SERVER_BASE_URL = `http://127.0.0.1:${String(READER_TEST_SERVER_PORT)}/`;

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TYPESCRIPT_CLI = resolve(WORKSPACE_ROOT, 'node_modules/typescript/bin/tsc');
const VITE_CLI = resolve(WORKSPACE_ROOT, 'node_modules/vite/bin/vite.js');

export function readerTestServerCommand(
  env: Readonly<Record<string, string | undefined>>,
  port = READER_TEST_SERVER_PORT,
): string {
  const node = quoteShellArgument(process.execPath);
  const tsc = `${node} ${quoteShellArgument(TYPESCRIPT_CLI)}`;
  const vite = `${node} ${quoteShellArgument(VITE_CLI)}`;
  const preview = `RITO_READER_BASE=/ ${vite} preview --host 127.0.0.1 --port ${String(port)}`;
  return env['RITO_READER_SKIP_E2E_BUILD'] === '1'
    ? preview
    : `${tsc} --noEmit -p tsconfig.app.json && ${tsc} --noEmit -p tsconfig.e2e.json && RITO_READER_BASE=/ ${vite} build && ${preview}`;
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
