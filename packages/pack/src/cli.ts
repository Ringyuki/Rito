#!/usr/bin/env node
// rito-pack <book.epub> <out-dir> [--encrypt]
//   Writes skeleton.rshd, shards/<id>.rshd, manifest.json (the book id
//   and, per shard, its file, byte length and the EPUB paths it carries;
//   no keys) and, with --encrypt, keys.json (every shard's key as 64 hex
//   digits). Keys and shards are written apart so they can be stored apart.
// rito-pack --check <book.epub>
//   Prints whether the Rito reader can read the book and the files it
//   shows degraded; exits 1 when it cannot.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { checkPublication, packPublication } from './index';
import type { PackedPublication, PackedShard } from './types';

const USAGE =
  'usage: rito-pack <book.epub> <out-dir> [--encrypt]\n       rito-pack --check <book.epub>';

type Command =
  | {
      readonly kind: 'pack';
      readonly input: string;
      readonly output: string;
      readonly encrypt: boolean;
    }
  | { readonly kind: 'check'; readonly input: string };

try {
  process.exitCode = await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`rito-pack: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function main(command: Command): Promise<number> {
  const epub = await readFile(command.input);
  if (command.kind === 'check') {
    const check = await checkPublication(epub);
    if (!check.readable) {
      console.error(`${command.input}: unreadable: ${check.error}`);
      return 1;
    }
    console.log(`${command.input}: readable, ${String(check.problems.length)} problems`);
    for (const problem of check.problems) console.log(`  ${problem.path}: ${problem.message}`);
    return 0;
  }
  const packed = await packPublication(epub, { encrypt: command.encrypt });
  await writeOutput(command.output, packed);
  console.log(
    `${command.output}: ${String(packed.shards.length)} content shards, skeleton ` +
      `${String(packed.skeleton.bytes.length)} bytes${packed.encrypted ? ', encrypted' : ''}`,
  );
  return 0;
}

function parseArgs(args: readonly string[]): Command {
  let encrypt = false;
  let check = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '--encrypt') encrypt = true;
    else if (arg === '--check') check = true;
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  const [input, output] = positional;
  if (check && !encrypt && input !== undefined && positional.length === 1) {
    return { kind: 'check', input };
  }
  if (!check && input !== undefined && output !== undefined && positional.length === 2) {
    return { kind: 'pack', input, output, encrypt };
  }
  throw new Error(USAGE);
}

async function writeOutput(output: string, packed: PackedPublication): Promise<void> {
  await mkdir(join(output, 'shards'), { recursive: true });
  await writeFile(join(output, 'skeleton.rshd'), packed.skeleton.bytes);
  for (const shard of packed.shards) {
    await writeFile(join(output, shardFile(shard)), shard.bytes);
  }
  await writeJson(join(output, 'manifest.json'), {
    format: 'rito-publication-shards',
    formatVersion: packed.formatVersion,
    bookId: packed.bookId,
    encrypted: packed.encrypted,
    skeleton: manifestEntry('skeleton.rshd', packed.skeleton),
    shards: packed.shards.map((shard) => manifestEntry(shardFile(shard), shard)),
  });
  if (!packed.encrypted) return;
  const keys: Record<string, string> = {};
  for (const shard of [packed.skeleton, ...packed.shards]) {
    if (shard.key === undefined) throw new Error(`shard ${String(shard.id)} has no key`);
    keys[String(shard.id)] = Buffer.from(shard.key).toString('hex');
  }
  await writeJson(join(output, 'keys.json'), { bookId: packed.bookId, keys });
}

function shardFile(shard: PackedShard): string {
  return `shards/${String(shard.id)}.rshd`;
}

function manifestEntry(file: string, shard: PackedShard): object {
  return { id: shard.id, file, byteLength: shard.bytes.length, files: shard.files };
}

async function writeJson(path: string, value: object): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
