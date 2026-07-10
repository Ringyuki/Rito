# Binary Wire V2 Local Evidence

Date: 2026-07-11 (Asia/Shanghai)

Decision: **no-go for making `RITORB1` the default reader metadata wire**.
Keep JSON as the production default and keep `RITORB1` private and opt-in.

## Scope And Limits

This report evaluates the first `createViewRevisionBundleBytes()` slice. It
does not evaluate a future frame-command ABI or justify moving search,
locator, or geometry payloads.

All measurements came from one machine, so they are sufficient for a local
no-go decision but not for a future go decision:

| Field                 | Value                                      |
| --------------------- | ------------------------------------------ |
| Measured Git revision | `3f1401eb60fd02560177a18ffcc5e0fec012d08f` |
| Host                  | Apple M3, 8 logical CPUs, 24 GiB           |
| OS                    | Darwin 25.5.0, arm64                       |
| Node                  | 24.10.0                                    |
| V8                    | 13.6.233.10-node.28                        |
| Chromium              | 147.0.7727.15                              |

## Fixed-Payload Decode Benchmark

Each selected fixture ran in five fresh Node processes. Every process used the
benchmark defaults: 1 second warmup, 20 alternating JSON/RITORB1 samples, and
roughly 6 seconds of measured work. JSON and binary payloads were generated
once per process from separate documents, checked for deep semantic equality,
then decoded repeatedly without layout or encoding inside the timed loop.

Times below are the median of the five per-process medians. Parentheses show
the full range of those process medians; they are not selected best cases.

| Fixture   | JSON bytes | RITORB1 bytes | Binary / JSON |      JSON decode ms |      RITORB1 decode ms |   Paired decode ratio |
| --------- | ---------: | ------------: | ------------: | ------------------: | ---------------------: | --------------------: |
| `book-01` |  1,224,806 |       972,344 |        79.39% | 2.403 (1.930–2.451) |  11.613 (9.435–11.898) | 4.852× (4.830–4.937×) |
| `book-06` |  1,093,785 |       859,581 |        78.59% | 3.074 (2.816–4.413) | 13.872 (12.338–17.010) | 4.280× (3.944–4.560×) |
| `book-10` |  2,130,866 |     1,730,630 |        81.22% | 3.481 (3.443–6.230) | 18.295 (17.882–28.393) | 5.185× (4.957–5.283×) |

Three larger local EPUBs were also sampled once with the same defaults. They
confirmed the direction rather than serving as the repeatability set:

| EPUB                            | JSON bytes | RITORB1 bytes | Binary / JSON | JSON ms | RITORB1 ms | Paired ratio |
| ------------------------------- | ---------: | ------------: | ------------: | ------: | ---------: | -----------: |
| `魔王学院の不適合者15`          |  1,670,233 |     1,363,749 |        81.65% |   3.032 |     13.951 |       4.577× |
| `为美好的世界献上祝福！1`       |    925,240 |       761,808 |        82.34% |   1.573 |      8.176 |       5.152× |
| `Re:ゼロから始める異世界生活 1` |    992,455 |       826,673 |        83.30% |   4.145 |     16.533 |       3.866× |

Result: the byte-size improvement is stable, but eager binary decoding is
consistently several times more expensive than `JSON.parse` on this runtime.

## Real WebWorker ABBA

`book-01` ran through three independent Playwright processes. Each process
created fresh contexts in JSON/RITORB1/RITORB1/JSON order and exercised initial
preview, deferred full layout, settings reflow, and six turns before and after
reflow. That produced six sessions per wire and twelve sessions total.

The table uses the median of the three run-level medians:

Ordinary turns still use JSON frame-window metadata plus `RITOFCB2`; only
revision-bundle delivery changes in this A/B. The turn metrics below are a
no-regression probe, not a measurement of `RITORB1` per-turn transport.

| Metric                         |       JSON |    RITORB1 | Binary / JSON |
| ------------------------------ | ---------: | ---------: | ------------: |
| Initial full raw wire bytes    |  1,222,119 |    969,698 |        79.35% |
| Reflow full raw wire bytes     |  1,226,073 |    973,227 |        79.38% |
| Initial full Rust encode       |     3.1 ms |    20.6 ms |         6.65× |
| Initial full JavaScript decode |     4.2 ms |    21.7 ms |         5.17× |
| Reflow full Rust encode        |     2.2 ms |    15.8 ms |         7.18× |
| Reflow full JavaScript decode  |     3.6 ms |    17.7 ms |         4.92× |
| Initial full ready             | 5,289.5 ms | 6,314.9 ms |         1.19× |
| Settings full ready            | 5,681.1 ms | 5,696.8 ms |         1.00× |
| Turn readiness median          |   5.768 ms |   8.316 ms |         1.44× |
| Turn frame-gap p95 median      |    17.7 ms |    17.7 ms |         1.00× |

End-to-end ready and turn times were noisy between processes; one run favored
binary and two did not. They do not support a general speedup claim. The
separately measured encode/decode costs were directionally consistent.

Functional acceptance passed in all twelve sessions:

- initial preview/full spread counts were always 8/167;
- reflow preview/full spread counts were always 1/292;
- every canvas was non-blank;
- there were no console or page errors;
- frame-gap p95 medians stayed at 17.6–17.7 ms for both wires;
- the first run had one isolated long task on each wire, and the next two runs
  had none.

## Post-Baseline Follow-Up

The measurements below were collected after the fixed decision matrix above.
They are implementation checkpoints, not replacements for the recorded
`3f1401e` baseline or evidence for changing the default wire.

- `ea15e7c67ffbf94b5010e8d9f9182751c4c503cb` changed only the JavaScript
  implementation of the existing V1
  FNV-1a checksum. A fresh-process `book-01` calibration reduced median
  `RITORB1` decode from the baseline 11.613 ms to 4.91-4.93 ms, or roughly
  2.20-2.21x JSON. The V1 bytes, checked golden, and rejection behavior stayed
  unchanged. This single-fixture follow-up is not the full repeatability
  matrix.
- `27fc8342fdd84f49f588ef129646a42847c49141` added a reader-private publication
  cache for document-stable full
  `chapterTextIndices`. The first full revision still carries inline entries;
  later full revisions from either reader worker carry a scoped reference that
  the facade hydrates back to the unchanged public object shape. Preview
  revisions, public JSON/debug methods, and generic `RITORB1` V1 payloads stay
  unchanged.

A real-WASM `book-01` calibration measured the full revision transport before
and after the scoped-reference projection:

| Wire      | Inline bytes | Reference bytes | Ref / inline | Inline Rust encode | Ref Rust encode |
| --------- | -----------: | --------------: | -----------: | -----------------: | --------------: |
| JSON      |    1,224,840 |          35,456 |        2.90% |           2.165 ms |        0.063 ms |
| `RITORB1` |      972,393 |          32,397 |        3.33% |          11.190 ms |        0.378 ms |

The dedicated browser ABBA smoke also passed after the change. In that run,
initial full payloads were 961,910 bytes for JSON and 789,703 bytes for
`RITORB1`; cached settings-reflow full payloads fell to 22,082 and 19,491 bytes
respectively. All sessions remained non-blank and error-free, and preview/full
revision counts and page-turn readiness checks passed.

The cache is scoped to one reader publication and shared only by that reader's
foreground/full worker clients. Publication identity is committed only after a
successful open, cached entries are hydrated from an immutable snapshot, and
invalid references or failed hydration release the newly created revision.

`f3298ae02477ab4787817b646c1570e380e5afac` then moved full-document indices
behind a document-owned lazy scope. Reader full-reference creation now omits
the metadata before bundle materialization; explicit revision reads still
initialize the shared full-document index on demand. Preview/window revisions
keep their revision-scoped materialized snapshots.

An 8+8 native release ABBA using `book-01`, fresh documents, the same JSON full
reference request, and a counting system allocator compared `032055a` with
`f3298ae`:

| Allocation metric                 |     `032055a` |     `f3298ae` |            Difference |
| --------------------------------- | ------------: | ------------: | --------------------: |
| Allocation count                  |    67,276,419 |    67,257,348 |               -19,071 |
| Cumulative allocated bytes        | 3,623,813,545 | 3,620,162,650 | -3,650,895 (3.48 MiB) |
| Live bytes added at method return |    33,306,133 |    31,887,059 | -1,419,074 (1.35 MiB) |
| Peak bytes added during method    |   266,843,654 |   266,843,654 |                     0 |

The allocation values were identical on every sample, confirming that the
full index is no longer materialized on a reference hit. Real WASM output also
remained identical at 35,456 bytes and 271 pages. Full-layout peak memory was
unchanged, and method timing was noisy enough to show no end-to-end speedup;
layout still dominates this operation. These measurements support a smaller
allocation footprint, not a claim that full reflow is faster.

These changes remove repeated transport work but do not reverse the no-go:
the first full payload remains inline, the binary reference still costs more
to encode/decode than JSON, and a second machine class has not been measured.

## Decision And Next Gate

The first slice is semantically sound and smaller on the wire, but the current
eager encoder/decoder does not earn a default switch:

1. JSON remains the production reader default.
2. `RITORB1` remains private and opt-in for agreement and performance work.
3. Do not move search, locator, geometry, or other payloads yet.
4. Continue reducing eager value-table materialization and first-inline
   encode/decode cost without changing V1 bytes or the public object-shaped
   facade. Do not optimize the remaining first-inline index copy without a
   measured allocation or latency case.
5. Re-run this matrix after that optimization, then add at least one second
   machine class before reconsidering the default.

## Reproduction

```sh
RITO_WIRE_EPUB=/absolute/path/book.epub \
  pnpm --filter @ritojs/core-wasm bench:runtime-wire
```

```sh
RITO_WIRE_EPUB=/absolute/path/book.epub \
  pnpm test:e2e:wire-ab
```
