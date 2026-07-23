// Unpacks every EPUB in a directory and writes a manifest the oracle
// scripts consume: per book, the spine-ordered chapter files and the
// @font-face bindings (declared family name → extracted font file).
//
//   node unpack-corpus.mjs <epub-dir> <workspace-dir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const [epubDir, workspace] = process.argv.slice(2).map((p) => resolve(p));
if (!epubDir || !workspace) {
  console.error('usage: node unpack-corpus.mjs <epub-dir> <workspace-dir>');
  process.exit(1);
}
mkdirSync(workspace, { recursive: true });

const manifest = [];
for (const name of readdirSync(epubDir).filter((n) => n.endsWith('.epub'))) {
  const epub = join(epubDir, name);
  const id = createHash('sha256').update(name).digest('hex').slice(0, 10);
  const dir = join(workspace, id);
  try {
    mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', epub, '-d', dir]);
    const container = readFileSync(join(dir, 'META-INF/container.xml'), 'utf8');
    const opfRel = container.match(/full-path="([^"]+)"/)?.[1];
    const opfPath = join(dir, opfRel);
    const opf = readFileSync(opfPath, 'utf8');
    const opfDir = dirname(opfPath);
    const items = new Map();
    for (const m of opf.matchAll(/<item\s[^>]*>/g)) {
      const idAttr = m[0].match(/\bid="([^"]+)"/)?.[1];
      const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
      if (idAttr && href) items.set(idAttr, decodeURIComponent(href));
    }
    const chapters = [];
    for (const m of opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)) {
      const href = items.get(m[1]);
      if (href) chapters.push([href.split('/').pop(), join(opfDir, href)]);
    }
    // @font-face bindings from every css file.
    const fonts = [];
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.css$/i.test(entry.name)) {
          const css = readFileSync(p, 'utf8');
          for (const face of css.matchAll(/@font-face\s*{[^}]*}/g)) {
            const family = face[0].match(/font-family\s*:\s*["']?([^;"'}]+)/)?.[1]?.trim();
            const src = face[0].match(/url\(\s*["']?([^)"']+)/)?.[1];
            if (family && src) {
              const fontPath = resolve(dirname(p), src);
              try {
                readFileSync(fontPath);
                fonts.push({ family, path: fontPath });
              } catch {
                /* missing font file */
              }
            }
          }
        }
      }
    };
    walk(dir);
    manifest.push({ epub, dir, chapters, fonts });
    console.log(`${id}  ${chapters.length} chapters  ${fonts.length} fonts  ${name.slice(0, 50)}`);
  } catch (error) {
    console.log(`SKIP ${name.slice(0, 50)}: ${String(error).slice(0, 100)}`);
  }
}
writeFileSync(join(workspace, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`manifest: ${join(workspace, 'manifest.json')} (${manifest.length} books)`);
