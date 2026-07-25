// Geometry-differential conformance: case generator + Chromium truth.
//
// Generates seeded synthetic cases per capability cluster, packs them as
// chapters of one cases.epub (fonts embedded), and records ground truth
// by rendering the very same XHTML files in Chromium and reading every
// id-carrying element's getBoundingClientRect. Zero harness injection:
// width, margins, and the font live in each case's own CSS, so the
// engine (via the epub) and Chromium (via file://) consume identical
// inputs. The engine side is crates/rito-core/examples/
// layout_conformance_probe.rs; tools/conformance/compare.mjs joins the
// two by element id.
//
// Usage: node tools/conformance/generate.mjs <outDir> [seed]

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const require = createRequire(`${REPO}package.json`);
const { chromium } = require('@playwright/test');

const [, , outDirArg, seedArg] = process.argv;
const outDir = outDirArg ?? '/tmp/rito-conformance';
const seed = Number(seedArg ?? 20260724);
const FLOW_WIDTH = 500;

// Deterministic LCG so a fixed seed reproduces the exact case set.
function rng(state) {
  let s = state >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

const CJK = '这是一段用于排版一致性测试的文字内容它没有标点符号以便让断行完全由宽度决定';
const text = (rand, min, max) => {
  const length = min + Math.floor(rand() * (max - min));
  let out = '';
  for (let i = 0; i < length; i += 1) out += CJK[Math.floor(rand() * CJK.length)];
  return out;
};

let elementId = 0;
const id = () => `e${(elementId += 1)}`;

// ---- capability cluster generators ------------------------------------
// Each returns inner-body HTML. Every generated element carries an id.

function verticalRhythmCase(rand) {
  const parts = [];
  const paragraphs = 3 + Math.floor(rand() * 6);
  for (let i = 0; i < paragraphs; i += 1) {
    const kind = rand();
    if (kind < 0.15) {
      parts.push(`<p id="${id()}"><br/></p>`);
    } else if (kind < 0.25) {
      parts.push(`<p id="${id()}">&#160;</p>`);
    } else {
      const margin = pick(rand, [
        '',
        'margin:0;',
        'margin:1em 0;',
        'margin:0.5em 0 1.5em 0;',
        'margin-top:2em;',
      ]);
      const lineHeight = pick(rand, [
        '',
        'line-height:1.2;',
        'line-height:1.8;',
        'line-height:24px;',
      ]);
      const indent = pick(rand, ['', 'text-indent:2em;']);
      const fontSize = pick(rand, ['', 'font-size:0.8em;', 'font-size:1.2em;']);
      parts.push(
        `<p id="${id()}" style="${margin}${lineHeight}${indent}${fontSize}">${text(rand, 10, 80)}</p>`,
      );
    }
  }
  return parts.join('\n');
}

function tableCase(rand) {
  const rows = 1 + Math.floor(rand() * 3);
  const cols = 1 + Math.floor(rand() * 3);
  const tableStyle = pick(rand, ['', 'margin:0 auto;', 'margin:1em 0;']);
  const parts = [`<table id="${id()}" style="${tableStyle}">`];
  for (let r = 0; r < rows; r += 1) {
    parts.push(`<tr id="${id()}">`);
    for (let c = 0; c < cols; c += 1) {
      const width = pick(rand, ['', 'width:5em;', 'width:10em;', 'width:40%;']);
      const valign = pick(rand, ['', 'vertical-align:middle;', 'vertical-align:top;']);
      if (rand() < 0.3) {
        parts.push(
          `<td id="${id()}" style="${width}${valign}"><div id="${id()}" style="width:12em;border:1px solid #000;">${text(rand, 8, 30)}</div></td>`,
        );
      } else {
        parts.push(`<td id="${id()}" style="${width}${valign}">${text(rand, 2, 25)}</td>`);
      }
    }
    parts.push('</tr>');
  }
  parts.push('</table>');
  return parts.join('\n');
}

function floatCase(rand) {
  const parts = [];
  const blocks = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < blocks; i += 1) {
    const side = pick(rand, ['left', 'right']);
    const size = pick(rand, ['3em', '5em']);
    parts.push(
      `<div id="${id()}" style="background:#eee;height:3em;">` +
        `<div id="${id()}" style="float:${side};width:${size};height:${size};background:#000;"></div>` +
        `<p id="${id()}" style="margin:0;">${text(rand, 15, 60)}</p>` +
        `</div>`,
    );
  }
  return parts.join('\n');
}

function imageCase(rand) {
  const parts = [];
  const blocks = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < blocks; i += 1) {
    const src = pick(rand, ['sq.png', 'wide.png']);
    const sizing = pick(rand, [
      'width:100%;',
      'width:5em;',
      'max-width:100%;',
      'width:50%;',
      'height:3em;',
      '',
    ]);
    const kind = rand();
    if (kind < 0.35) {
      // In a table cell whose width constrains the image.
      const cellWidth = pick(rand, ['width:4em;', 'width:8em;', '']);
      parts.push(
        `<table id="${id()}"><tr id="${id()}"><td id="${id()}" style="${cellWidth}">` +
          `<img id="${id()}" style="${sizing}" src="../Images/${src}" alt="i"/></td>` +
          `<td id="${id()}">${text(rand, 3, 12)}</td></tr></table>`,
      );
    } else if (kind < 0.7) {
      parts.push(
        `<div id="${id()}" style="width:${pick(rand, ['10em', '20em', '100%'])};">` +
          `<img id="${id()}" style="${sizing}" src="../Images/${src}" alt="i"/></div>`,
      );
    } else {
      parts.push(
        `<p id="${id()}"><img id="${id()}" style="${sizing}" src="../Images/${src}" alt="i"/></p>`,
      );
    }
  }
  return parts.join('\n');
}

function marginBoxCase(rand) {
  const parts = [];
  const blocks = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < blocks; i += 1) {
    const margin = pick(rand, [
      'margin:0 auto;width:15em;',
      'margin-left:6em;width:12em;',
      'margin:-1em 0 0 4em;width:10em;',
      'margin:1em 2em;',
    ]);
    parts.push(
      `<div id="${id()}" style="${margin}border:1px solid #000;">${text(rand, 5, 30)}</div>`,
    );
  }
  return parts.join('\n');
}

const CLUSTERS = [
  { name: 'vertical-rhythm', generate: verticalRhythmCase, cases: 40 },
  { name: 'tables', generate: tableCase, cases: 40 },
  { name: 'floats', generate: floatCase, cases: 30 },
  { name: 'margin-box', generate: marginBoxCase, cases: 30 },
  { name: 'images', generate: imageCase, cases: 30 },
];

/// Encodes a solid RGB PNG without external dependencies: raw deflate
/// stored blocks keep the encoder to a few lines, and conformance images
/// only need exact intrinsic dimensions.
function solidPng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStore(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function zlibStore(data) {
  const blocks = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < data.length; offset += 65535) {
    const slice = data.subarray(offset, offset + 65535);
    const last = offset + 65535 >= data.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = last;
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    blocks.push(header, slice);
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(data) >>> 0);
  blocks.push(adler);
  return Buffer.concat(blocks);
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- epub packing ------------------------------------------------------

const rand = rng(seed);
const buildDir = path.join(outDir, 'build');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(buildDir, 'META-INF'), { recursive: true });
mkdirSync(path.join(buildDir, 'OEBPS', 'Text'), { recursive: true });
mkdirSync(path.join(buildDir, 'OEBPS', 'Fonts'), { recursive: true });

cpSync(
  path.join(REPO, 'apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf'),
  path.join(buildDir, 'OEBPS', 'Fonts', 'conf.otf'),
);

mkdirSync(path.join(buildDir, 'OEBPS', 'Images'), { recursive: true });
// Two solid PNGs with distinct intrinsic ratios: 100x100 and 300x150.
const PNGS = {
  'sq.png': solidPng(100, 100, [0x30, 0x60, 0xc0]),
  'wide.png': solidPng(300, 150, [0xc0, 0x50, 0x30]),
};
for (const [name, bytes] of Object.entries(PNGS)) {
  writeFileSync(path.join(buildDir, 'OEBPS', 'Images', name), bytes);
}

const caseCss = [
  '@font-face { font-family: "__conf"; src: url(../Fonts/conf.otf); }',
  `body { margin: 0; width: ${FLOW_WIDTH}px; font-family: "__conf"; font-size: 16px; }`,
].join('\n');
writeFileSync(path.join(buildDir, 'OEBPS', 'case.css'), caseCss);

const cases = [];
for (const cluster of CLUSTERS) {
  for (let index = 0; index < cluster.cases; index += 1) {
    const name = `${cluster.name}-${String(index).padStart(3, '0')}`;
    elementId = 0;
    const body = cluster.generate(rand);
    const xhtml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!DOCTYPE html>',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title>',
      '<link href="../case.css" rel="stylesheet" type="text/css"/>',
      `</head><body>`,
      body,
      '</body></html>',
    ].join('\n');
    writeFileSync(path.join(buildDir, 'OEBPS', 'Text', `${name}.xhtml`), xhtml);
    cases.push({ name, cluster: cluster.name });
  }
}

const imageItems = Object.keys(PNGS)
  .map(
    (name) =>
      `<item id="img-${name.replace('.', '-')}" href="Images/${name}" media-type="image/png"/>`,
  )
  .join('\n    ');
const manifestItems = cases
  .map(
    (c) => `<item id="${c.name}" href="Text/${c.name}.xhtml" media-type="application/xhtml+xml"/>`,
  )
  .join('\n    ');
const spineItems = cases.map((c) => `<itemref idref="${c.name}"/>`).join('\n    ');
writeFileSync(
  path.join(buildDir, 'OEBPS', 'content.opf'),
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">rito-conformance-cases</dc:identifier>
    <dc:title>Rito conformance cases</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="css" href="case.css" media-type="text/css"/>
    <item id="font" href="Fonts/conf.otf" media-type="font/otf"/>
    ${imageItems}
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`,
);
writeFileSync(
  path.join(buildDir, 'META-INF', 'container.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
);
writeFileSync(path.join(buildDir, 'mimetype'), 'application/epub+zip');

const epubPath = path.join(outDir, 'cases.epub');
execFileSync('zip', ['-X', '-0', epubPath, 'mimetype'], { cwd: buildDir });
execFileSync('zip', ['-rq', epubPath, 'META-INF', 'OEBPS', '-x', 'OEBPS/Images/*'], {
  cwd: buildDir,
});
// Images enter stored: these solid PNGs deflate so well that a compressed
// entry trips the reader's zip-bomb ratio guard.
execFileSync('zip', ['-rq0', epubPath, 'OEBPS/Images'], { cwd: buildDir });

// ---- Chromium ground truth --------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: FLOW_WIDTH + 100, height: 800 },
  deviceScaleFactor: 1,
});
const truth = {};
for (const c of cases) {
  await page.goto(`file://${path.join(buildDir, 'OEBPS', 'Text', `${c.name}.xhtml`)}`);
  await page.evaluate(() => document.fonts.ready);
  truth[c.name] = await page.evaluate(() => {
    const boxes = {};
    for (const el of document.querySelectorAll('[id]')) {
      const rect = el.getBoundingClientRect();
      boxes[el.id] = {
        tag: el.tagName.toLowerCase(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
    return boxes;
  });
}
// Host normal-line metrics for every font size the cases use: the plain
// strut (latin/empty lines) and the CJK-lifted height, measured from the
// same browser that recorded the geometry truth. The engine consumes
// these verbatim — the numbers come from the host font scaler and are
// not derivable from font tables.
const hostMetrics = await page.evaluate(
  (sizes) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const measure = (size, probe) => {
      const p = document.createElement('p');
      p.setAttribute('style', `margin:0;font-size:${size}px;`);
      // The zero-sized inline-block sits on the baseline, so its top is
      // the baseline offset from the line box top.
      p.innerHTML = `${probe}<span style="display:inline-block;width:0;height:0"></span>`;
      host.appendChild(p);
      const box = p.getBoundingClientRect();
      const marker = p.querySelector('span').getBoundingClientRect();
      return { height: box.height, baseline: marker.top - box.top };
    };
    return sizes.map((size) => {
      const plain = measure(size, 'x');
      const lifted = measure(size, '试');
      return {
        family: '__conf',
        size,
        strut: plain.height,
        cjk: lifted.height,
        strutBaseline: plain.baseline,
        cjkBaseline: lifted.baseline,
      };
    });
  },
  [12.8, 16, 19.2],
);
await browser.close();

writeFileSync(
  path.join(outDir, 'truth.json'),
  JSON.stringify({ seed, cases, truth, hostMetrics }, null, 1),
);
console.log(`generated ${cases.length} cases → ${epubPath}; truth recorded`);
