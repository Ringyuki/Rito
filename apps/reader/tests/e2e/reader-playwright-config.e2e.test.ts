import { expect, test } from '@playwright/test';
import { readerTestServerCommand } from './reader-test-server';

test('builds before preview by default', () => {
  const command = readerTestServerCommand({}, 4321);

  expect(command).toContain("node_modules/typescript/bin/tsc' --noEmit -p tsconfig.app.json");
  expect(command).toContain("node_modules/typescript/bin/tsc' --noEmit -p tsconfig.e2e.json");
  expect(command).toContain("node_modules/vite/bin/vite.js' build");
  expect(command).toContain("node_modules/vite/bin/vite.js' preview --host 127.0.0.1 --port 4321");
  expect(command).not.toContain('pnpm');
});

test('can reuse one prebuilt dist for same-commit cold A/B samples', () => {
  const command = readerTestServerCommand({ RITO_READER_SKIP_E2E_BUILD: '1' }, 4321);

  expect(command).toContain("node_modules/vite/bin/vite.js' preview --host 127.0.0.1 --port 4321");
  expect(command).not.toContain('typescript/bin/tsc');
  expect(command).not.toContain(' vite build');
  expect(command).not.toContain('pnpm');
});

test('does not skip the build for values other than the explicit 1 switch', () => {
  expect(readerTestServerCommand({ RITO_READER_SKIP_E2E_BUILD: '0' }, 4321)).toContain(
    "node_modules/typescript/bin/tsc' --noEmit -p tsconfig.app.json",
  );
});
