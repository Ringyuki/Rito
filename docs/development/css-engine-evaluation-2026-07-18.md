# CSS Engine Evaluation: Current Rust, TypeScript, and Stylo

Status: decision record and reproducible spike, 2026-07-18; production status
updated 2026-07-19.

## 2026-07-19 production status update

The decision has advanced from an isolated spike through a Stylo-first
strangler to a **strict Stylo production resolver**. Default `rito-core` and
`rito-wasm` product builds physically exclude the hand-written CSS parser,
cascade, and prepared legacy cache. Production cannot automatically fall back:
rejected source topology, configuration, viewport state, Stylo execution, or
materialization returns a typed error. The retired implementation is available
only through the explicit `legacy-css-diagnostics` feature for compatibility
analysis (`bench-internals` implies it). Normal publication loading retains the
legacy `css`/`style` DTO fields as `null` and does not create a legacy cache.

The pinned 10-book production corpus result is a historical pre-gate routing
snapshot recorded in
[`stylo-production-corpus-wave5-20260719.json`](../../benchmarks/css-engine-spike/results/stylo-production-corpus-wave5-20260719.json):

| Production corpus route                    |    Result |
| ------------------------------------------ | --------: |
| Books / chapters                           |  10 / 290 |
| Stylo chapter resolves                     |   290/290 |
| Automatic legacy-parser fallbacks          |         0 |
| Source/engine/materialization fallback sum |         0 |
| Named Duokan single-image flex elisions    |        10 |
| Peak process-tree RSS                      | 410.0 MiB |

The table preserves the original artifact's fallback and elision counters; it
must not be read as the current architecture. The default product now contains
neither an automatic fallback nor a legacy cache. The former Duokan elision has
also been replaced by a real but deliberately bounded single-image flex path:
`display: flex` with block outside display, `row`, `nowrap`, exactly one image,
positive absolute container height, and centering on both axes. It is not
general flexbox and does not implement grid; unsupported flex/grid shapes stay
outside the production contract. Wave4 independently records that typed
`rotate()` support moved the historical route from 64/290 to 265/290 chapters;
the final background, presentational-hint, radius, height, and wrapper work
moved that snapshot to 290/290.

The post-gate strict resolver was then rerun against the same 10 books and is
recorded in
[`stylo-strict-routing-post-gate-20260719.json`](../../benchmarks/css-engine-spike/results/stylo-strict-routing-post-gate-20260719.json).
It again resolved 290/290 chapters with every fallback counter at zero while
loading and fully paginating 2,797 pages in 17,631.954 ms; guarded peak
process-tree RSS was 409.1 MiB. The example enables `bench-internals` only to
expose counters, while publication loading stays on the strict production
resolver. This is one sequential full-pagination run, not a cold-open,
first-screen, or CSS-only latency measurement.

The current typed bridge additionally carries opacity, maps supported
`page-break-before`/`page-break-after` aliases into Rito pagination fields, and
preserves root/body typography and `font-family` through materialization and
reader overrides. These are specific closed slices, not evidence of complete
CSS, flex, grid, pagination, or EPUB support.

The current integrated latency evidence is the three-run median in
[`book10-stylo-production-median-20260719.json`](../../benchmarks/css-engine-spike/results/book10-stylo-production-median-20260719.json):

| Book10 production probe    |                Three-run median/result |
| -------------------------- | -------------------------------------: |
| Pagination workload        | 771 pages / 392 spreads / 2,014 quanta |
| Target page/spread         |                768/390; `matched=true` |
| Stylo chapter resolves     |                                  25/25 |
| Compatibility fallbacks    |                                      0 |
| Legacy prepared-base calls |                                      0 |
| Style time                 |           74.195 ms; **6.963× faster** |
| End-to-end wall time       |        1,237.575 ms; **1.396× faster** |
| Peak process-tree RSS      |                              148.9 MiB |

The speedups compare the median current run with the recorded historical
bounded-pagination baseline: style time falls by 85.638% and wall time by
28.383%. The current side has three samples; the historical baseline is a
single run. This is production-path evidence that the CSS switch
materially reduced style work and total probe latency. It is not evidence that
cold open, initial-position restoration, page-turn animation, cached frame
publication, or rapid TOC navigation is solved.

The integrated WASM target compiles, but its current post-`wasm-bindgen`
module is **12,299,941 bytes** and **4,864,072 bytes gzip**. That proves the
DOM-free adapter is portable to WASM; it does not pass the existing bundle-size
gate.

The remaining strangler gates are concrete:

- `@page` is admitted by the source inventory as a deliberate compatibility
  no-op. Neither current materialization nor the legacy behavior applies page
  box margins; Book10's 5 pt top/bottom `@page` margins are therefore ignored.
  Standards accuracy requires a Rito supplemental page cascade.
- The visual-golden difference for `border: currentColor inset 1px` is an
  intentional bug-fix difference. Stylo preserves the computed width and
  `currentColor` and maps unsupported `inset` paint to stable drawable solid;
  the legacy parser incorrectly consumed `inset` as a color. Golden review
  must record that difference rather than use the legacy pixels as the oracle.
- Production still creates and drops a `StyleDocument` per chapter
  resolution. Compiled styles and session state are not retained across
  reflow/restyle, so retained sessions and targeted invalidation remain
  performance gates.
- Resolved `@import`, pseudo/generated-content consumers, the remaining
  pagination/CJK profile gaps, Miri coverage for the unsafe sidecar, complete
  visual-golden review, bundle reduction, and reader-level latency gates remain
  open.
- The production resolver is fail-closed and returns typed errors for
  unsupported third-party input. Compatibility analysis requires an explicit
  `legacy-css-diagnostics` build and is not a production recovery mechanism;
  wider input coverage must be added to the Stylo projection/layout contract,
  not restored through silent fallback.

The historical benchmark and differential sections below are retained as
decision provenance. Their V3/V4/V5 `production 0/3` results and later
zero-fallback routing counters describe pre-gate artifacts—not the current
strict build graph. The legacy implementation still exists for explicit
diagnostics, but it is physically excluded from default products. The current
route is not a claim of full CSS or EPUB conformance.

## Decision

Continue with the **direct Stylo adapter through the strict production
resolver**, with these constraints:

1. Pin the crates.io release exactly (`stylo = "=0.19.0"`) with the lockfile
   checksum; do not track Stylo's rebased Git `main` branch and do not fork it
   now.
2. Keep Stylo behind a private, typed Rito adapter. Stylo types must not cross
   into layout, render, runtime, or public APIs.
3. Use Blitz only as an integration reference and feasibility/performance
   probe, not as an independent semantic oracle. Blitz must not be a production
   dependency.
4. Keep the hand-written resolver physically excluded from default product
   builds. It may be compiled only through the explicit diagnostics feature;
   production Stylo rejection must remain a typed error, never a silent
   fallback.
5. Stop broad feature expansion in the current hand-written CSS engine. Only
   fix migration blockers, regressions, and adapter-oracle defects there.

This originally approved an engineering spike and then a Stylo-first
strangler. The later feature gate supersedes its automatic-fallback policy:
legacy code is diagnostics-only and absent from default products. It still
does **not** approve removing page-turn animation. CSS resolution, pagination,
initial-location restoration, navigation scheduling, frame caching, and
animation smoothness are separate gates.

The reason for choosing Stylo is not “Rust is automatically fast.” The measured
hand-written Rust implementation disproved that. The reason is that Stylo
combines a browser-grade CSS model with the compiled selector indexes, sharing,
and invalidation algorithms needed to make Rust's native/WASM integration
useful.
Stylo describes itself as the Rust CSS engine used by Servo and Firefox; the
repository is Servo's downstream of the canonical implementation in
mozilla-central. Its crates are also explicitly described as mostly
implementation details, so the adapter must absorb API instability rather than
letting it spread through Rito. See the [Stylo repository](https://github.com/servo/stylo).

## Bottom line

The former default hand-written CSS resolver did **not** achieve the
performance purpose of the Rust rewrite; these measurements explain why the
Stylo migration was necessary:

- On the three measured real chapters, after removing the recursive sibling
  deep clone, current Rust first style resolution is still **2.92–6.61× slower
  than the TypeScript reference**.
- Its repeated full resolve is **4.55–9.60× slower than TypeScript**.
- In 20 targeted `font-size` semantic cases, current Rust passes **4/20** and
  both the historical Stylo/Blitz probe and the new direct Stylo adapter pass
  **20/20**.
- In the new rotated five-process direct-adapter suite, direct Stylo V0 first
  resolution is directionally **56.92–69.91× faster than TypeScript** and
  **171.76–434.50× faster than current Rust**. Forced full restyle is
  **41.76–53.52× faster than TypeScript** and **192.14–518.11× faster than
  current Rust**.
- The historical V1 differential paired all 2,806 legacy source elements, but
  its **1,567/2,806** `display` result compared the raw legacy
  `style.display` slot, not the effective layout semantics jointly encoded by
  that slot and `StyledNodeKind`. It is retained as raw-slot provenance and is
  explicitly superseded as CSS-engine correctness evidence.
- In the schema-v4 V2 suite, direct Stylo passes both the original selected
  cascade smoke gate (**20/20**) and the new EPUB projection gate (**6/6**).
  Across five fresh processes per fixture, `cascade + ResolvedStylesV2`
  materialization takes **0.276–0.410 ms** on first resolve and **0.207–0.329
  ms** on forced full restyle. The directional matched-process medians are
  **46.83–57.75× faster than TypeScript** and **136.79–355.58× faster than
  current Rust** for first resolve. V2 has 21 typed style fields, not the full
  production layout/paint contract, so these are headroom measurements rather
  than reader speedup claims.
- The fail-closed schema-v3 canonical-scope run accounts for every one of
  **58,926** node×field outcomes across 2,806 paired legacy elements. The
  exactly comparable subset contains **47,567 bit-exact matches, 0 numeric
  equivalents, and 0 mismatches**; **11,224** outcomes are legacy-unavailable,
  **56** legacy-lossy, **66** topology-dependent, and **13** input-model
  differences. All 174 direct-only nodes remain explicitly unaudited for box
  generation/suppression. Consequently scope, same-work, full-projection, and
  production gates pass in **0/3** (fail in **3/3**), as they should; this is
  caused by unaudited topology, unequal inputs, and a structurally incomplete
  projection, not by a comparable-field mismatch. No timing ratio is eligible.
- The schema-v4 legacy-UA algorithm-isolation run closes the fixed-workload
  input ledger: the same `SourceArena`, 1280×720/1×/light viewport values,
  source-node-attested author order, empty unsupported-media inventory, and
  byte-identical UA profile pass in **3/3**. That stricter comparison exposes
  **1,173 real `display` mismatches** that V3's different UA profiles had
  hidden. Across 58,926 outcomes, V4 records **46,403 exact matches**, 1,173
  mismatches, 11,224 legacy-unavailable, 47 legacy-lossy, 66
  topology-dependent, and 13 input-model outcomes. All 186 direct-only nodes
  remain topology-unaudited, and full projection is still false; scope and
  production therefore pass in **0/3** and no performance ratio is eligible.
- The fail-closed schema-v5 source-element topology run accounts for all
  **2,992 source elements** across the three chapters. Its exact/mismatch/
  incomplete outcomes are **40/1,173/34**, **17/659/137**, and **919/3/10**.
  The runner validates all three reports and fixed-input same-work passes
  **3/3**, but topology, canonical scope, full projection, production, and
  performance-ratio eligibility pass **0/3**. The mismatches are dominated by
  the legacy `html`/`body` root-style-carrier and canonical-parent integration
  model; `br` hard-break conversion remains unprojected. This is topology
  integration evidence, not a CSS-accuracy percentage or performance ratio.
- At the same JS-to-WASM function boundary, but with different output work,
  Stylo's median `instantiate + first call` is **1.23–2.97× faster**, and its
  subsequent fresh-document call is **10.18–22.09× faster**.

The first two bullets are the closest implementation comparison: both Rito
resolvers run the corresponding fixture style path, and the formal artifacts
show equal element and projection-node counts on all three chapters. The
[recorded real EPUB parity run](../../benchmarks/css-engine-spike/results/real-epub-parity.json)
passes for the three books under `smoke.greedy`. This still does not mean
identical low-level work: TypeScript and Rust have different preparation and
allocation strategies. The Stylo ratios are only directional evidence because
the current engine constructs a full Rito styled/text tree while the Stylo
probe hashes primary styles on elements. They demonstrate substantial headroom,
not a promised product multiplier.

No pre-cutover hand-written-vs-direct-Stylo ratio in the V5 diagnostic suite
passes its scope and full-projection eligibility gates. Those historical
ratios remain useful only as non-equivalent CSS-path headroom measurements;
the separate 2026-07-19 Book10 result above measures the integrated production
route.

Rust remains the correct long-term core language only if the product realizes
its actual advantages:

- one implementation for native and WASM consumers;
- typed ownership and bounded lifetimes instead of a large JavaScript object
  graph;
- direct integration with shaping, layout, pagination, caches, and binary frame
  output;
- a long-lived worker/session model with retained compiled CSS and styles;
- predictable memory and cancellation behavior;
- hot paths that are measurably and materially faster than the TypeScript
  reference.

Language choice alone provides none of those results. Algorithms, retained
state, data representation, and boundary work determine the outcome.

## Evidence classes

The results deliberately separate nine evidence classes.

| Class | What is compared                                                                    | What it can prove                                                                                                   |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A     | Current Rust vs TypeScript reference, same Rito fixture path and projection         | Current implementation performance; real parity is separately verified                                              |
| B     | Current Rust WASM vs Stylo/Blitz WASM, same exported function signature             | Direction and available engine headroom; not a final product ratio                                                  |
| C     | 20 hand-reviewed semantic micro-cases                                               | Selected candidate behavior and known gaps; not an independent oracle or CSS conformance percentage                 |
| D     | Isolated control, legacy probe, Stylo/Blitz probe, and current full Rito WASM sizes | Hash-verifiable size bounds; not the integrated direct-adapter delta                                                |
| E     | Historical shared-`SourceArena` V1 five-field/raw-slot run                          | Raw historical evidence; its display comparison is not an effective-layout or accuracy gate                         |
| F     | EPUB UA/profile semantics and 21-field V2 projection on three real chapters         | Selected typed-contract correctness and CSS-path headroom; not conformance, canonical parity, or reader performance |
| G     | Fail-closed V3 21-field canonical accounting on the same source identity            | Exact comparable-subset agreement and explicit gaps; not same-work, full projection, production pass, or ratio      |
| H     | Fail-closed V4 legacy-UA algorithm-isolation accounting                             | Fixed-workload input equivalence plus exact mismatches; not topology parity, full projection, or a valid ratio      |
| I     | Fail-closed V5 source-element producer-topology accounting                          | Audited topology integration outcomes and gaps; not CSS accuracy, full projection, production pass, or a ratio      |

No RSS multiplier is reported. The native binary links both Rust engines and
the TypeScript process includes Node and happy-dom, so whole-process memory is
not an engine-allocation comparison. The formal suite now records the
in-process lifecycle high-water mark in addition to the 20 ms external sampler;
this closes the short-process sampling blind spot and is retained only as a
safety diagnostic.

The local `memory-guard.mjs` is a **250 ms sampled process-tree tripwire**, not
an OS-enforced address-space or cgroup limit. It terminates the observed process
group after a sampled breach and all heavy builds use one Cargo job, but it
cannot rule out a shorter inter-sample spike. “2 GiB/3 GiB limit” below refers
to this sampled ceiling unless an OS-level CI limit is explicitly named.

The source boundary was separately hardened after identifying a concrete
entity-expansion RAM risk. `SourceArena` now disables DTD processing, the
normalizer removes the `DOCTYPE` declaration before strict parsing, and
references to internal DTD entities are rejected rather than expanded. This
closes that risk but does not prove that it caused any previously observed RAM
spike. Under the sampled guard, `rito-source` passed 18 tests with a 230.1 MiB
peak; `rito-core` passed 1,089 unit tests plus its integration and workspace
smoke checks with a 1,581.9 MiB peak. These are process-tree samples, not
engine-allocation measurements or OS-enforced maximums.

## Direct Stylo adapter vertical slice

The repository now contains `crates/rito-source`, the platform-neutral source
tree, and `crates/rito-stylo`, a private adapter pinned to
`stylo = "=0.19.0"` with the Servo feature profile. It does not use Blitz. The
vertical slice contains:

- one canonical, namespace-aware immutable `SourceArena` with stable `NodeId`
  values;
- an `Arc<SourceArena>` shared by `rito-core` and `rito-stylo`, so chapter XHTML
  is parsed once rather than into parallel core and style trees;
- a pinned host-tree facade and mutable style sidecar implementing Stylo's DOM
  and selector traits;
- ordered UA, user, and author stylesheet origins;
- a retained, sequential `StyleDocument` session and full-restyle hook in the
  adapter API, although the production caller does not yet cache that session
  across chapter resolutions;
- real Stylo animation state retained across `resolve_at(time)` calls;
- deliberately small Rito-owned `ResolvedStylesV0`, typed same-node
  `ResolvedStylesV1`, and production-oriented 21-field `ResolvedStylesV2`
  projections;
- an XHTML-namespace-scoped Rito EPUB support-profile UA stylesheet and
  zero-specificity `dir=ltr/rtl` presentational hints; and
- executable selector/cascade/namespace/animation tests, including known-fail
  expectations for Servo's unsupported `:has()` and
  `:nth-child(... of selector)` parsing.

Stylo and all adapter-local unsafe code remain behind this crate boundary.
Nothing is exported through Rito's public TypeScript or Rust API. `rito-core`
now invokes the adapter through its private strict production resolver; the
reader and WASM consumers reach it only through existing core APIs. Default
products do not link the diagnostics-only legacy parser/cascade/cache.
Page-turn animations were not removed or modified.

### DOM-free host-tree boundary

Stylo does not require a browser DOM. Its upstream APIs call the embedding
abstraction “DOM,” but those traits describe operations on a host-owned tree:
parent/child/sibling traversal, element names, namespaces, attributes, and a
place to associate private style data. Rito implements that interface over
`SourceArena`; it does not import browser `Document`/`Element` objects,
`window`, Web APIs, an HTML parser, `web-sys`, or a JavaScript runtime.
`rito-source` and the direct adapter compile for `wasm32-unknown-unknown` as
well as native targets, so native, server, worker, and DOM-free WASM consumers
keep the same source model.

DOM-free does not mean tree-free. CSS selectors inherently need topology,
namespaces, attributes, and stable element identity. The architectural choice
is therefore one small Rito-owned tree, not no tree and not a second browser
object graph. `SourceArena::from_xhtml` is the single parse boundary;
`rito-core::parse_xhtml_from_source` derives Rito semantic nodes from the same
arena, while `rito-stylo::StyleDocument::from_source` retains another cheap
`Arc` reference and builds only style-specific metadata. Stylo's mutable style
and invalidation state stays in a private sidecar, so it does not make the
shared source topology mutable or leak into locator, layout, render, or public
APIs.

### Direct native V0 timing

The direct suite uses five fresh processes per engine and fixture, five warm
samples per process, and three cyclic engine orders. All 45 child runs are
serialized behind a 2 GiB child RSS limit and the complete suite runs behind a
3 GiB process-tree limit. Values are milliseconds. Displayed engine times are
cross-process medians; displayed ratios are medians of the five matched-process
ratios, so they need not equal the quotient of the rounded time columns.

| Fixture | Direct first | TS first | TS/direct | Current first | Current/direct | Direct forced restyle | TS repeat | TS/direct | Current repeat | Current/direct |
| ------- | -----------: | -------: | --------: | ------------: | -------------: | --------------------: | --------: | --------: | -------------: | -------------: |
| book-01 |        0.337 |   21.727 |    63.11× |       143.513 |        434.50× |                 0.278 |    15.009 |    53.52× |        144.316 |        518.11× |
| book-06 |        0.230 |   13.094 |    56.92× |        38.122 |        171.76× |                 0.189 |     7.942 |    41.76× |         36.227 |        192.14× |
| book-10 |        0.272 |   19.521 |    69.91× |        65.519 |        237.62× |                 0.274 |    12.321 |    45.52× |         64.213 |        234.10× |

The geometric means of the three per-fixture matched-process median ratios are
**63.09× TS/direct** and **260.78× current/direct** for first resolve, then
**46.68× TS/direct** and **285.64× current/direct** for forced full restyle.

These large ratios are real measurements of the current V0 paths, but they are
not yet a product speedup claim. Direct V0 projects node identity, element
name, ID, `font-size`, and a coarse `display` category. The production Rito
style has 76 fields and also feeds generated content, font selection, shaping,
layout, pagination, paint, and hit testing. Direct Stylo walks the complete XML
element tree, while the Rito reference projections are body/styled-tree based;
their element counts and digests are therefore intentionally non-equivalent.
The next valid performance gate requires a versioned canonical contract,
independently attested same-work inputs, and the full production projection.
“76 fields” is not itself a sound target: it is 76
TypeScript object slots, including derived caches and split px/percentage
representations, rather than 76 independent CSS computed properties.

The process-lifecycle high-water RSS medians and five-process ranges were:

| Fixture |            Direct Stylo V0 |               Current Rust |          TypeScript reference |
| ------- | -------------------------: | -------------------------: | ----------------------------: |
| book-01 | 16.141 (16.141–16.188) MiB | 83.500 (83.406–83.563) MiB | 252.813 (247.141–254.750) MiB |
| book-06 | 15.031 (14.984–15.063) MiB | 52.172 (52.094–52.250) MiB | 217.359 (211.078–303.406) MiB |
| book-10 |    9.859 (9.844–9.891) MiB | 62.188 (62.156–62.234) MiB | 182.969 (181.844–185.438) MiB |

These are whole-process safety observations, including runtime startup and EPUB
loading, not comparable incremental engine memory. Every measured child stayed
below 304 MiB; both the external sampler and the in-process high-water mark are
enforced against the 2 GiB child limit before a run can be recorded as success.

The exact raw samples, paired ratios, source/binary/fixture hashes, environment,
and safety settings are in the schema-v2
[direct Stylo native summary](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.manifest.json),
and [raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.raw.jsonl).
The earlier
[single-process V0 smoke artifact](../../benchmarks/css-engine-spike/results/direct-stylo-v0-smoke-2026-07-18.json)
is retained only as exploratory history. The final root release build peaked at
938.8 MiB sampled process-tree RSS, below the configured 3 GiB ceiling; the independent
benchmark rebuild peaked at 933.1 MiB, and the final formal suite peaked at
335.0 MiB including its runner. No runtime RSS ratio is reported.

### Historical same-source V1 differential (superseded)

V1 closed the source-identity loophole left by V0, but it did **not** close the
field-definition or node-set gate. Both engines received the same
`Arc<SourceArena>` and the run attempted to align viewport, the then-current
Rito UA text, active external stylesheets, embedded stylesheets, and inline
declarations. However, its pass predicate did not require node-set equality,
and its `display` comparator read only the legacy JSON slot while the current
layout actually combines that slot with `StyledNodeKind`. V1 therefore cannot
serve as CSS-engine accuracy or same-canonical-output evidence.
`SourceRef.source_node_id` is retained through the current semantic and styled
trees. The comparator then joins source-backed element records by `NodeId` and
compares four typed values plus the raw legacy display slot:

- `fontSize` and `fontWeight` as numeric computed values;
- `lineHeight` as `Normal | Number | LengthPx`;
- the raw `style.display` slot converted to outside + inside + list-item
  components; and
- `color` as canonical sRGBA.

Text nodes and pseudo-elements are excluded from V1. Direct-only nodes are
reported rather than silently dropped; they are the complete XML nodes that
the current semantic tree omits or converts, such as `html`, `head`, `body`,
metadata/style/script nodes, and `br`.

| Fixture   |   Shared / legacy | Direct-only |        fontSize |      fontWeight |      lineHeight | raw display slot |           color |
| --------- | ----------------: | ----------: | --------------: | --------------: | --------------: | ---------------: | --------------: |
| book-01   |     1,212 / 1,212 |          35 |     1,212/1,212 |     1,212/1,212 |     1,168/1,212 |          0/1,212 |     1,212/1,212 |
| book-06   |         674 / 674 |         139 |         674/674 |         674/674 |         671/674 |          655/674 |         674/674 |
| book-10   |         920 / 920 |          12 |         920/920 |         920/920 |         920/920 |          912/920 |         920/920 |
| **Total** | **2,806 / 2,806** |     **186** | **2,806/2,806** | **2,806/2,806** | **2,759/2,806** |  **1,567/2,806** | **2,806/2,806** |

No legacy value was unavailable for these five fields, and the V1 join reported
zero legacy-only nodes. All three cases were non-matching. The two historical
difference classes expose schema problems rather than candidate accuracy:

1. Current Rito initializes the `style.display` slot to `block` for every
   element while separately storing block/inline semantics in `StyledNodeKind`.
   Stylo returns CSS computed `display`; the exact current UA sheet does not
   duplicate that hidden classifier. Forcing `* { display: block }` would make
   the old slot match while making the future layout contract less accurate.
   Thus the historical **1,567/2,806** is raw-slot provenance only; the V3
   comparator supersedes it with effective-layout accounting.
2. Current Rito represents the default line height as numeric `1.2`; Stylo
   preserves `normal`, whose used value depends on real font metrics. Mapping
   `normal` to `1.2` would again improve legacy parity by discarding information.

The run also recorded one diagnostic timing per fixture. Current full resolve
was 145.553, 38.170, and 65.951 ms; direct resolve plus the five-field typed V1
projection was 0.715, 0.252, and 0.316 ms. These are single correctness runs,
not independent performance samples, and output still differs in two fields;
therefore no V1 speedup ratio is claimed. All children completed normally. The
largest in-process high-water mark was 63.781 MiB, the largest 20 ms sampled RSS
was 55.250 MiB, and the outer guarded suite peaked at 88.6 MiB.

The exact historical payloads, mismatch samples, binary/source/fixture hashes, dirty
worktree state, and safety settings are in the
[V1 differential summary](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.manifest.json),
and [raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.raw.jsonl).

### Production-oriented V2 projection

V2 stops treating the old engine's defaults as the correctness oracle. The
production entry point injects an XHTML-namespace-scoped Rito EPUB UA support
profile, then lets UA, user, author, inline, and presentational-hint origins
cascade normally. HTML `dir=ltr/rtl` enters Stylo at the zero-specificity
`PresHints` level, inherits through the computed style, remains author
overridable, and does not affect SVG namespace elements.

`ResolvedStylesV2` contains three identity fields and 21 typed style fields:
font size/weight/style, typed line height and display, compatibility sRGBA
color, opacity, box sizing, horizontal auto margins, direction, writing mode,
typed `unicode-bidi`, text align/justify/transform, the two white-space
longhands, word/line breaking, and overflow wrapping. Exhaustive mappings keep
valid distinctions such as
`line-height: normal`, `text-align: start/end`, vertical writing modes,
`pre-line`, and `overflow-wrap: anywhere` instead of flattening them to old
defaults.

The V2 runner uses five fresh processes per engine and fixture, five repeats per
process, cyclic engine ordering, a 2 GiB child limit, and the same outer 3 GiB
process-tree guard. Direct times below include Stylo cascade and complete V2
materialization. The separate post-resolve metric in the artifact is only an
FNV-1a digest. Ratios are medians of five matched-process ratios and are
directional because current Rust and TypeScript still build non-equivalent Rito
styled trees.

| Fixture | V2 elements | Direct first | TS/direct | Current/direct | Direct forced restyle | TS/direct | Current/direct |
| ------- | ----------: | -----------: | --------: | -------------: | --------------------: | --------: | -------------: |
| book-01 |       1,245 |        0.410 |    52.69× |        355.58× |                 0.329 |    45.98× |        440.23× |
| book-06 |         807 |        0.276 |    46.83× |        136.79× |                 0.207 |    37.92× |        176.76× |
| book-10 |         928 |        0.331 |    57.75× |        201.29× |                 0.302 |    41.54× |        213.98× |

The geometric means of the three matched-process median ratios are **52.23×
TS/direct** and **213.93× current/direct** for first resolve, then **41.68×
TS/direct** and **255.35× current/direct** for forced full restyle. Every one of
the 45 child runs completed successfully. The V2 element count and full-field
digest were identical across all five processes for each fixture: `8989d98a2e0cda4b`,
`870b7b7786b06c68`, and `1cebffd1a64e1e02`, respectively. Direct whole-process
high-water RSS medians were 16.500, 15.125, and 10.156 MiB, with a maximum of
16.594 MiB; these remain safety diagnostics, not engine-allocation comparisons.
All 15 short Stylo children exited before the supplemental 20 ms sampler
completed its first sample, so the artifact records that field as `null` with
zero samples rather than the misleading value 0 MiB. The recorded outer
guarded suite peaked at 294.3 MiB.

The correctness command passes all 20 selected cascade/selector cases and all
six V2 cases: EPUB UA display (including closed `dialog` and first `summary`),
author override of `[hidden]`, HTML `dir` inheritance/override plus common
`bdi`/`bdo` isolation, writing mode/direction, typed text/paint/box projection,
and the `Normal | Number | LengthPx` line-height distinction. Six hand-selected
cases are not a conformance percentage, and the real-book suite currently
checks deterministic V2 counts/digests rather than a per-field browser/WPT
oracle.

V2 intentionally leaves important work visible:

- `line-height: normal` is preserved but its used line metrics still need real
  OpenType metrics and shaped fallback runs in layout;
- `color` remains a compatibility legacy-sRGB field until Rito owns a
  wide-gamut absolute-color schema;
- `dir=auto`/`bdi` first-strong direction and the special `input`/`textarea`
  bidi rules are not yet implemented;
- closed `details` content and disclosure markers still need a Rito semantic
  equivalent of the HTML UA's internal `details-content` box; CSS selectors
  alone cannot model its text-node and box-generation behavior faithfully;
- the UA sheet is an EPUB support profile, not the complete WHATWG browser UA;
  and
- pseudo/generated content, font integration, layout, pagination, locators,
  navigation, painting, frame caches, WASM product integration, and page-turn
  animation are outside this benchmark.

Therefore V2 shows large directional timing headroom on the measured,
non-equivalent 21-field path. It does not establish an eligible
current-vs-Stylo ratio, does not pass the same-canonical-output production gate,
and does not prove that the reader itself is faster.

The exact samples and provenance are in the schema-v4
[V2 native summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.manifest.json),
[raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.raw.jsonl),
and the outer [command/RSS record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.command.json).

### Fail-closed V3 canonical-scope accounting

V3 replaces V1's raw-slot comparison with a versioned, fail-closed accounting
protocol. It captures the legacy semantic element scope before cascade,
resolves both engines from the same `Arc<SourceArena>`, joins by stable
`NodeId`, audits identity and suppression, and accounts for all 21 V2 fields on
every participating legacy element. Every field outcome is exactly one of:
bit-exact match after declared normalization, numeric-equivalent, mismatch,
legacy-unavailable, legacy-lossy, topology-dependent, or input-model
difference. Exact and tolerance-equivalent values are separate, and each
field's SHA-256 includes both legacy and direct values.

| Fixture   | Paired nodes | Eligible outcomes | Exact comparable | Numeric equivalent | Mismatch | Legacy unavailable | Legacy lossy | Topology dependent | Input-model difference | Direct-only unaudited |
| --------- | -----------: | ----------------: | ---------------: | -----------------: | -------: | -----------------: | -----------: | -----------------: | ---------------------: | --------------------: |
| book-01   |        1,212 |            25,452 |           20,498 |                  0 |        0 |              4,848 |           53 |                 41 |                     12 |                    33 |
| book-06   |          674 |            14,154 |           11,437 |                  0 |        0 |              2,696 |            3 |                 17 |                      1 |                   133 |
| book-10   |          920 |            19,320 |           15,632 |                  0 |        0 |              3,680 |            0 |                  8 |                      0 |                     8 |
| **Total** |    **2,806** |        **58,926** |       **47,567** |              **0** |    **0** |         **11,224** |       **56** |             **66** |                 **13** |               **174** |

The comparable subset coverage is **47,567/58,926 = 80.7233%**. Every value in
that exactly comparable subset agrees, but this is **not** “100% CSS accuracy”:
19.2767% of the declared V2 outcomes remain unavailable, lossy,
topology-dependent, or input-model-dependent. The 56 lossy outcomes are 47
`line-height: normal` values collapsed to legacy `1.2` plus nine list-item
display values. The 66 topology-dependent field outcomes are all legacy
`display`/`StyledNodeKind` splits. The 13 input-model differences are image
`boxSizing` defaults under different UA models.

All 2,806 identities pair exactly, with no duplicate or legacy-only `NodeId`,
and the participating-node suppression ledger closes. The direct side also has
174 source elements outside the legacy semantic scope: six `html`/`body`
wrappers, three `display:none` elements, and 165 converted `br` elements. V3
classifies them but deliberately marks every one **semantic-unaudited**; a tag
label cannot prove equal box generation or suppression. Therefore the topology
and scope gates fail all three chapters.

Input/work eligibility is independently false. The grouped author stylesheet
sequence hashes match on each chapter, but:

- the legacy media environment does not model the direct side's DPR and color
  scheme even though both use 1280×720 CSS pixels;
- external and embedded sheets are still grouped rather than attested in full
  document source order; and
- the legacy and EPUB-support UA profiles have different SHA-256 values
  (`64222905…` vs `4c9952dc…`).

Finally, `fullProjectionComplete` is structurally `false`: pseudo/anonymous
boxes and the remaining layout/paint-consumed contract are outside this
21-field protocol. Thus `scopeGatePassed`, `sameWorkEligible`,
`scopedCanonicalGatePassed`, and `productionGatePassed` are all false for 3/3
chapters. The runner defaults to a nonzero exit on this state. Stored timings
are single-run diagnostics only; `performanceRatioEligible` is false, and no
ratio may be calculated from them.

The schema-v3 runner validates the child protocol, fixed EPUB/chapter/style
hashes, node/field ledgers, gate formulas, and ordered digests independently.
In the same guarded command it validates the 76-slot AST ledger, performs a
locked/offline/single-job release build into a fixed target directory, and
requires identical source hashes before/after build and after execution. The
formal evidence is in the
[V3 summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.manifest.json),
[raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.raw.jsonl),
and [command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.command.json).
The command record exits 1 because the default suite gate correctly fails; all
three child processes exit 0 with no validation error. Its 67,518,464-byte peak
is the runner's 20 ms child sample, not an outer-guard measurement. The outer
250 ms tripwire observed 221.0 MiB in this incremental formal run, but that
console observation is not embedded in the current hashed artifacts.

### Fail-closed V4 same-work algorithm isolation

V4 preserves the V3 artifact and changes the workload instead of retroactively
changing its meaning. Both engines now receive the same legacy UA bytes rather
than comparing legacy semantic defaults against Rito's newer EPUB-support UA.
The runner independently pins and checks, per chapter:

- fixture, XHTML, and complete `SourceArena` node counts;
- 1280×720 CSS pixels, DPR 1, and light color-scheme input values;
- separate legacy/direct author ledgers, their record counts and source
  `NodeId` order (`[5]`, `[8,10]`, `[11,13]`), CSS byte hashes, and ordered
  aggregate hashes;
- the same legacy UA profile ID and byte hash (`64222905…`); and
- an empty unsupported-media ledger for the selected sheets.

Conditional `<link>/<style>` applicability, alternate/disabled/non-CSS sheets,
unexpanded `@import`, and actual `@media` use now fail closed. This proves input
equivalence for the fixed 21-field algorithm-isolation workload, not complete
engine capability parity: legacy DPR/color-scheme media evaluation and
URL/base resolution remain explicitly unproven, and
`fullProjectionComplete` remains false.

| Fixture   | Paired nodes | Eligible outcomes | Exact match |  Mismatch | Legacy unavailable | Legacy lossy | Topology dependent | Input-model difference | Direct-only unaudited |
| --------- | -----------: | ----------------: | ----------: | --------: | -----------------: | -----------: | -----------------: | ---------------------: | --------------------: |
| book-01   |        1,212 |            25,452 |      19,336 |     1,171 |              4,848 |           44 |                 41 |                     12 |                    35 |
| book-06   |          674 |            14,154 |      11,435 |         2 |              2,696 |            3 |                 17 |                      1 |                   139 |
| book-10   |          920 |            19,320 |      15,632 |         0 |              3,680 |            0 |                  8 |                      0 |                    12 |
| **Total** |    **2,806** |        **58,926** |  **46,403** | **1,173** |         **11,224** |       **47** |             **66** |                 **13** |               **186** |

The comparable domain is 47,576/58,926 = **80.7386%**; within it, exact
agreement is 46,403/47,576 = **97.5345%**. All 1,173 mismatches are `display`.
Under identical legacy-UA bytes, Stylo correctly retains CSS initial inline
display for elements such as `p`, while the legacy parser independently turns
semantic tag names into block layout nodes. V3's EPUB UA supplied explicit
block defaults to Stylo and therefore hid this architectural difference. V4 is
the first measurement that makes that discrepancy visible under an attested
same-input workload.

Topology also remains open. The direct side has 186 source elements outside
the legacy semantic scope: six `html/body` wrappers, 165 `br` elements converted
by the legacy parser before cascade, and 15 unclassified head/resource nodes.
None is declared equivalent from its tag alone. Consequently
`sameWorkEligible` passes 3/3, while topology, canonical scope, full projection,
production, and performance-ratio eligibility pass 0/3.

The formal evidence is the V4
[summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.manifest.json),
[raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.raw.jsonl),
and [command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.command.json),
with suite run ID `same-canonical-2026-07-18T13:53:35.036Z-78831`. The default
command exits 1 as intended; all three children exit 0 with no validation
error. The runner's 20 ms sample peaks at 67,534,848 bytes. The outer 250 ms
tripwire observed 234.6 MiB, but that console observation is not embedded in
the hashed command record.

### Fail-closed V5 source-element topology accounting

V5 preserves V4's same-work style comparison and adds two independently
hashed topology ledgers keyed by source `NodeId`. The Rust child records actual
legacy and direct producer outcomes, including source parent/sibling identity,
root carriers, principal elements, suppression, canonical parent/order, and
incomplete conversions. The JavaScript runner independently replays the
records, counts, ordering, hashes, and gate formulas rather than trusting the
child's reported result.

| Fixture   | Source elements | Exact topology | Topology mismatch | Incomplete topology | Same-work eligible | Topology gate |
| --------- | --------------: | -------------: | ----------------: | ------------------: | -----------------: | ------------: |
| book-01   |           1,247 |             40 |             1,173 |                  34 |               Pass |          Fail |
| book-06   |             813 |             17 |               659 |                 137 |               Pass |          Fail |
| book-10   |             932 |            919 |                 3 |                  10 |               Pass |          Fail |
| **Total** |       **2,992** |        **976** |         **1,835** |             **181** |            **3/3** |       **0/3** |

The accounting closes—every source element has exactly one outcome—but the
topology projection does not. Most mismatches come from the legacy semantic
tree treating `html`/`body` as root style carriers and flattening or changing
the canonical parent relation that the direct source tree retains. `br`
elements converted into hard breaks by the legacy parser are recorded but are
not yet projected to a declared direct equivalent, so they remain incomplete.
Pseudo/anonymous/generated boxes and the consumer-complete layout/paint
contract remain outside the protocol. Therefore topology, scoped canonical,
full-projection, production, and performance-ratio gates fail 3/3 even though
fixed-input same-work passes 3/3.

The formal evidence is the V5
[summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.json),
[manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.manifest.json),
[raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.raw.jsonl),
and [command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.command.json),
with suite run ID `same-canonical-2026-07-18T15:31:38.909Z-51352`. Their SHA-256
values are `1bac4080…`, `5893693d…`, `4f560a0c…`, and `95923783…`, respectively.
The default command exits 1 as intended; all three children exit 0 and all
runner `validationError` values are null. The runner's 20 ms sample peaks at
73,351,168 bytes and the outer 250 ms tripwire observed 1,061.8 MiB. Neither is
an OS-enforced memory cap. Because topology and full projection are false, the
single-run latency fields are diagnostics only: V5 supplies no eligible CSS or
reader performance ratio.

### The 76-slot projection audit

The historical TypeScript `ComputedStyle` has exactly 76 top-level slots: 60
required and 16 optional. `font` is a cache derived from four other font
fields; px and percentage variants split single CSS values across parallel
slots; text nodes duplicate their inherited style object. Current Rust has no
typed equivalent: `StyledNode.style` is a JSON map, the fixture summary checks
only 38/76 slots, and the old benchmark digest hashes only 5/76.

Against the full value domain of pinned Stylo 0.19's Servo profile, the strict
mapping audit classifies the old slots as:

| Classification                                                    | Slots | Meaning                                                                             |
| ----------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------- |
| Direct, lossless computed projection                              |    13 | The current slot can represent every relevant Stylo value                           |
| Needs typed schema, used value, font/layout basis, or Rito policy |    59 | A getter exists or a value can be derived, but flattening now loses valid CSS state |
| Unavailable in the Servo profile                                  |     4 | `pageBreakBefore`, `pageBreakAfter`, `orphans`, `widows`                            |

This is now a machine-checkable disposition ledger rather than an unaudited
aggregate. The 59 `needs` rows split into 29 `typed-basis`, 15 Rito-policy, and
15 derived/cache/split-view rows. The
[versioned JSON ledger](../../benchmarks/css-engine-spike/contracts/legacy-computed-style-76-ledger-v1.json)
is checked by a
[TypeScript-AST validator](../../benchmarks/css-engine-spike/validate-style-contract-ledger.mjs)
against the actual interface: indices 1–76, names, order, 60 required/16
optional, enum domains, counts, required metadata, and the exact four-row
unavailable set must all close.

The 13 direct rows use an explicit carriage rule: complete typed
`AbsoluteColor`/shadow values or standards-preserving canonical CSS
serialization count as lossless storage, while Canvas/output-device gamut is a
separate renderer gate. If that rule is rejected, the ledger must be versioned
and recomputed; **13/59/4 is not an invariant and never an accuracy score**.

The largest blockers are structural, not getter work: the old model omits
`writing-mode` and `direction`; `LengthPercentage`, intrinsic sizes, insets,
radii, transforms, and layered backgrounds cannot be losslessly flattened to
the old scalar slots; `line-height: normal` needs real font metrics; and EPUB
pagination remains a Rito-owned supplement. The production route is therefore
Stylo cascade/computed values → Rito-owned typed projection → layout/paint used
values. It is not Stylo → old 76-slot JSON map.

V2 implements the first 21 typed style fields along that route. This is broader
than the V1 five-field differential, but it does not convert the 76-slot audit
into a 21/76 accuracy score: several old slots are derived caches or split
representations, while some production requirements such as writing mode did
not exist in the old shape at all.

### `InlineFormattingStyleV1` implementation status

The repository now also contains the leaf crate `rito-style-contract` and a
strict direct producer exposed privately as
`StyleDocument::resolve_inline_styles_v1`. The contract has no Stylo, DOM,
source-tree, layout, serializer, or platform dependency. It preserves the V1
font, text flow, bidi, inline fragment, color, decoration, and shadow fields as
typed computed values, then interns them into a dense source-node table.

This V1 is deliberately named a **migration slice**, not
“consumer-complete.” The report API uses `ContractProjected` /
`ContractRejected` dispositions and `is_contract_slice_complete`; it has no
method that claims CSS or reader equivalence. Important omitted inputs still
include font feature/variant/kerning/stretch controls, tab sizing,
`text-rendering`, background layers, opacity, transforms, generated content,
pagination, and block/replaced-element layout. A separate omitted-property and
consumer gate is required before any full-projection claim.

The implementation is fail-closed in several places:

- every source element has exactly one deterministic disposition and an exact
  `ContractProjected <=> Some(StyleId)` dense-slot invariant;
- all opaque Stylo `calc()`/CSS Math values are rejected because Stylo 0.19
  does not expose enough of the computed AST to prove the V1 linear form;
- `alignment-baseline`, `baseline-source`, and `baseline-shift` remain three
  independent longhands instead of being lossily compressed into a classic
  `vertical-align` enum;
- `text-decoration` stores the element's own computed longhands. Decoration
  propagation must happen over the generated CSS box tree with decorating-box
  identity; it is not DOM inheritance and is not copied down a source-parent
  chain;
- wide-gamut colors retain their absolute color space and component scale;
  missing components and alpha have canonical validated representations;
- dependent colors retain `currentColor` symbolically. Simple `currentColor`
  shadows therefore remain shareable across elements with different
  foregrounds; complex color functions that still depend on it are rejected
  as unsupported instead of being eagerly expanded or guessed;
- font-family, text-shadow, and box-shadow lists are capped at 256 items before
  projection allocation. This is a projection-layer item budget, not a limit
  on the CSS parser's input byte length;
- a duplicate source-node assignment is rejected before interning can mutate
  the table.

The first table design also exposed a retained-memory amplification: a unique
outer field such as language could otherwise cause a large inherited
font-family or shadow list to be deep-owned by every style. The table now
canonicalizes immutable nested payloads before outer interning. The direct
producer additionally caches upstream shared list identities for the lifetime
of one synchronous projection. Repeated inherited Stylo `ArcSlice` payloads
are projected once and then hit the table's identity fast path; the cache owns
no raw borrow and cannot outlive the style slots that keep those allocations
alive. A 2,048-unique-style contract regression and direct operation-count
regressions verify that storage and work scale with unique payloads rather than
elements times list length. Both result tables are non-`Clone`; report
`Debug` output is bounded to counts, and callers receive read-only table and
disposition views so they cannot invalidate accounting after construction.

Language inheritance is likewise precomputed once in dense `SourceArena`
order. `xml:lang` takes precedence over `lang`, an empty declaration resets
inheritance, canonicalized tags are shared, and later `:lang()` matching or V1
projection reads the sidecar in O(1) per element instead of repeatedly walking
ancestors.

Guarded local validation currently passes **14/14** contract tests and
**26/26** direct-adapter tests, **40/40 combined**. The latest post-invariant
single-job run peaked at **476.7 MiB** sampled process-tree RSS. The strict
legacy producer also passes **5/5** targeted tests; its cold compile-and-test
process tree peaked at **1,580.4 MiB**. These figures are tripwire diagnostics,
not engine allocation measurements. The strict producer evidence below is now
replayed and hashed, but the full consumer path and a same-output production
benchmark remain open, so this milestone supplies **no eligible performance
ratio** and does not supersede the formal V5 hashes above.

### Strict V1 producer evidence and diagnostic latency

The `rito-inline-contract-v1/cold-evidence` mode now runs both strict producers
over the same `Arc<SourceArena>`, viewport values, byte-identical legacy UA,
and source-ordered author stylesheets. The suite independently validates every
aggregate, runs each of the three fixed chapters twice in a fresh process, and
requires the input, ledger, disposition, and style-table semantic digests to be
identical on replay.

| Fixture   |  Elements | Legacy exact fields | Legacy policy fields | Legacy unavailable | Legacy complete styles | Direct projected | Direct rejected | Direct interned styles |
| --------- | --------: | ------------------: | -------------------: | -----------------: | ---------------------: | ---------------: | --------------: | ---------------------: |
| book-01   |     1,247 |               4,839 |               20,604 |             16,955 |                      0 |            1,247 |               0 |                     13 |
| book-06   |       813 |               2,692 |               11,462 |             13,488 |                      0 |              813 |               0 |                     10 |
| book-10   |       932 |               3,676 |               15,644 |             12,368 |                      0 |              932 |               0 |                      9 |
| **Total** | **2,992** |          **11,207** |           **47,710** |         **42,811** |                  **0** |        **2,992** |           **0** |                 **32** |

The legacy ledger closes all **101,728 = 2,992 × 34** field outcomes with zero
invalid numeric/shape outcomes, but only 11,207 are lossless map values. Policy
changes or missing computed provenance account for the remaining 90,521, so a
strict legacy producer deliberately interns no complete V1 style. Direct Stylo
projects all 2,992 elements in this corpus and deduplicates them to 32 styles.
This is a contract-slice result, not a full CSS accuracy percentage.

The two cold observations also expose a large candidate native advantage:

| Fixture |     Legacy resolve | Direct resolve + exact V1 projection | Raw diagnostic ratio |
| ------- | -----------------: | -----------------------------------: | -------------------: |
| book-01 | 147.934–155.709 ms |                       1.076–1.441 ms |         108.0–137.5× |
| book-06 |   37.393–38.031 ms |                       0.673–0.702 ms |           53.3–56.5× |
| book-10 |   65.692–66.555 ms |                       0.868–0.959 ms |           69.4–75.7× |

Those are measured values, but **not an eligible performance ratio**. The
legacy side cannot construct the compared complete output; its 34-field audit
is lazy and timed separately, while direct materializes and interns exact
styles; and two deterministic replays are not an independent-process
distribution. The correct conclusion is narrower: Stylo now demonstrates the
order-of-magnitude latency headroom required to justify the native direction,
but Rito must carry the typed table through shaping/layout/paint and then rerun
same-output reader workloads before claiming a production speedup.

The formal suite run ID is
`inline-v1-2026-07-18T18:14:18.035Z-19668`. Validation and replay pass 6/6;
the fail-closed outer 3 GiB tripwire observes **108.9 MiB** peak process-tree
RSS including the final single-job release build check, while the child
high-water values range from 35.8 to 53.0 MiB. The manifest hashes 486 source
files, including the root workspace manifest and all 415 files under
`crates/rito-core/src`. Summary, manifest, raw, and command SHA-256 values are
`a1311cf8…`, `521e9591…`, `e9124719…`, and `6c39e441…`.

The V3 80.7233% comparable-subset coverage is orthogonal to this ledger. Its
11,224 `legacy-unavailable` outcomes mean the current Rust JSON model lacks four
of the 21 V2 comparison fields on 2,806 nodes; they are not Stylo's four
unavailable historical slots, and neither number is 76-slot completion.

## EPUB capability boundary of Stylo's Servo profile

The direct adapter changes the decision in one important way: the crates.io
`stylo` Servo profile is not the complete Firefox/Gecko CSS profile. Projection
work can close adapter gaps, but it cannot expose properties that the Servo
profile does not parse or compute.

| EPUB-critical area      | Pinned Stylo 0.19 Servo status                                                                                                                                                                                                                                                                                                                                                    | Decision impact                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pagination              | The Servo profile does not provide the complete Gecko pagination set. Rito's source adapter now bridges supported `break-before`/`break-after` and legacy `page-break-before`/`page-break-after` declarations into typed before/after pagination values. `@page` remains an explicit no-op; named page, size, `widows`, `orphans`, and broader break semantics remain incomplete. | Keep the bounded alias bridge, and add a Rito pagination cascade extension or small upstream-traceable patch set for the remaining semantics; source acceptance alone is not computed page-style support. |
| CJK vertical typography | `writing-mode` works; `text-orientation`, `text-combine-upright`, ruby positioning/alignment, text emphasis, and hyphen controls are Gecko-only                                                                                                                                                                                                                                   | Writing mode alone is not sufficient for Japanese vertical EPUB parity                                                                                                                                    |
| Selectors               | Standard combinators, namespaces, `:is/:where/:not`, classic `nth-*`, and `:lang` work; Servo rejects `:has()`, `nth-child(... of S)`, and lacks `:dir()`                                                                                                                                                                                                                         | Record explicit unsupported diagnostics; patch only if corpus data makes them release blockers                                                                                                            |
| Generated content       | `counter-reset` and `counter-increment` are disabled by the current Servo preference profile; `counter-set` and `@counter-style` are Gecko-only                                                                                                                                                                                                                                   | Full list numbering, footnote numbering, and generated-content parity need dedicated work                                                                                                                 |
| Multi-column            | Core count/width/gap/span values are available; `column-rule-*` and `column-fill` are Gecko-only, and Stylo does not implement Rito fragmentation                                                                                                                                                                                                                                 | Continue to own column layout and fragmentation in Rito                                                                                                                                                   |
| Pseudo-elements         | Eager styles can exist for `::before`, `::after`, and `::first-letter`; `::marker` is lazy; `::first-line` is absent                                                                                                                                                                                                                                                              | The adapter needs pseudo projection and a generated-content consumer                                                                                                                                      |
| Animation               | Standard document-timeline CSS animation state works and is tested; scroll/view timelines, animation range/composition, and `prefers-reduced-motion` are absent                                                                                                                                                                                                                   | Preserve the animation pipeline and add timeline/iteration differential tests; never use CSS-engine migration as a reason to remove reader animation                                                      |

The upstream findings above are grounded in the exact locked crate source:
`stylesheets/rule_parser.rs`, `properties/longhands.toml`,
`properties/shorthands.toml`, `properties/counted_unknown_properties.py`, and
`servo/selector_parser.rs` from `stylo-0.19.0`. They must be re-audited on every
Stylo upgrade.

The current adapter also has P0 work that does **not** require a fork:

- `@import` is rejected until the publication loader can preserve URL base,
  media, supports, layers, order, and cycle semantics;
- the EPUB support-profile UA stylesheet is intentionally narrower than a full
  browser UA; there is still no CSS diagnostic sink, embedded-font bridge, or
  real `ex/ch/cap/ic/line-height: normal` metric provider;
- the production EPUB source ledger supplies XHTML `<style>` and linked
  stylesheets in author order, but resolved `@import` remains unsupported;
- `@page` is an admitted no-op: current materialization, like the legacy path,
  does not apply Book10's 5 pt top/bottom page-box margins;
- only primary styles are projected, so pseudo styles and generated content
  are not consumed;
- dynamic selector state is nearly empty, including `:target`; therefore the
  initial-locator bug cannot be considered fixed by this adapter; and
- there is no real mutation API yet, so transitions cannot be exercised by a
  state, stylesheet, or viewport change.

Accordingly, the recommendation is **not** to fork all of Stylo and replace
Rito immediately. Continue with the pinned direct adapter, implement the
adapter-owned gaps, and build full differential corpora for pagination, CJK,
fonts, generated content, initial `:target`, and animation. Only then decide
whether the remaining Servo compile gates justify a small, explicit Stylo
patch set or a Rito-owned supplemental cascade. A broad long-lived fork would
inherit browser-engine rebase and security maintenance before the required
delta is even measured.

## Auditable protocol and artifacts

The formal run used an Apple M3 MacBook Air with 24 GiB RAM, Rust 1.95.0,
wasm-bindgen 0.2.120, and Node 24.14.0. Exact hashes, toolchain details, dirty
worktree state, fixture hashes, engine order, and raw samples are stored with
the results:

- [native summary](../../benchmarks/css-engine-spike/results/native-suite.json)
- [Book10 Stylo-first production three-run median](../../benchmarks/css-engine-spike/results/book10-stylo-production-median-20260719.json)
- [production corpus wave3, 64/290 Stylo](../../benchmarks/css-engine-spike/results/stylo-production-corpus-wave3-20260719.json)
- [production corpus wave4, 265/290 Stylo](../../benchmarks/css-engine-spike/results/stylo-production-corpus-wave4-20260719.json)
- [production corpus wave5, 290/290 Stylo](../../benchmarks/css-engine-spike/results/stylo-production-corpus-wave5-20260719.json)
- [native manifest](../../benchmarks/css-engine-spike/results/native-suite.manifest.json)
- [native raw JSONL](../../benchmarks/css-engine-spike/results/native-suite.raw.jsonl)
- [WASM summary](../../benchmarks/css-engine-spike/results/wasm-suite.json)
- [WASM manifest](../../benchmarks/css-engine-spike/results/wasm-suite.manifest.json)
- [WASM raw JSONL](../../benchmarks/css-engine-spike/results/wasm-suite.raw.jsonl)
- [WASM size report](../../benchmarks/css-engine-spike/results/wasm-size.json)
- [three-book real EPUB parity record](../../benchmarks/css-engine-spike/results/real-epub-parity.json)
- [100-call Stylo stability run](../../benchmarks/css-engine-spike/results/wasm-stylo-book01-100.json)
- [1,000-call Stylo stability run](../../benchmarks/css-engine-spike/results/wasm-stylo-book01-1000.json)
- [direct Stylo V0 smoke run](../../benchmarks/css-engine-spike/results/direct-stylo-v0-smoke-2026-07-18.json)
- [direct Stylo native summary](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.json)
- [direct Stylo native manifest](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.manifest.json)
- [direct Stylo native raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-native-suite-2026-07-18.raw.jsonl)
- [direct Stylo V1 differential summary](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.json)
- [direct Stylo V1 differential manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.manifest.json)
- [direct Stylo V1 differential raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v1-differential-2026-07-18.raw.jsonl)
- [direct Stylo V2 native summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.json)
- [direct Stylo V2 native manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.manifest.json)
- [direct Stylo V2 native raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.raw.jsonl)
- [direct Stylo V2 command and outer-RSS record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-native-suite-2026-07-18.command.json)
- [direct Stylo V3 canonical-scope summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.json)
- [direct Stylo V3 canonical-scope manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.manifest.json)
- [direct Stylo V3 canonical-scope raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.raw.jsonl)
- [direct Stylo V3 canonical-scope command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-canonical-scope-2026-07-18.command.json)
- [direct Stylo V4 same-work canonical-scope summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.json)
- [direct Stylo V4 same-work canonical-scope manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.manifest.json)
- [direct Stylo V4 same-work canonical-scope raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.raw.jsonl)
- [direct Stylo V4 same-work canonical-scope command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-same-work-canonical-scope-2026-07-18.command.json)
- [direct Stylo V5 topology canonical-scope summary](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.json)
- [direct Stylo V5 topology canonical-scope manifest](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.manifest.json)
- [direct Stylo V5 topology canonical-scope raw JSONL](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.raw.jsonl)
- [direct Stylo V5 topology canonical-scope command record](../../benchmarks/css-engine-spike/results/direct-stylo-v2-topology-canonical-scope-2026-07-18.command.json)
- [strict inline V1 producer summary](../../benchmarks/css-engine-spike/results/inline-formatting-v1-evidence-2026-07-18.json)
- [strict inline V1 producer manifest](../../benchmarks/css-engine-spike/results/inline-formatting-v1-evidence-2026-07-18.manifest.json)
- [strict inline V1 producer raw replay JSONL](../../benchmarks/css-engine-spike/results/inline-formatting-v1-evidence-2026-07-18.raw.jsonl)
- [strict inline V1 producer command record](../../benchmarks/css-engine-spike/results/inline-formatting-v1-evidence-2026-07-18.command.json)

The benchmark source and lockfiles are part of this change. Because the formal
run was made from a dirty worktree, the manifest's content hashes are necessary
for verification; the run becomes independently reproducible only after this
exact source patch is retained in version control or a source archive.

Protocol:

- 3 real EPUB chapters;
- 5 independent fresh processes per engine and fixture;
- engines executed serially with rotated/alternating order;
- native processes contain 5 measured repeat operations in original order;
- WASM processes contain 10 measured calls in original order;
- 1280×720 CSS-pixel viewport, DPR 1, screen media, light color scheme;
- 30-second child timeout and 2 GiB child RSS kill limit;
- all builds were single-job and guarded by a 3 GiB process-tree RSS limit;
- process startup and EPUB load/decode are excluded from latency, but included
  in both sampled RSS and the process-lifecycle high-water RSS.

The historical V1 differential and the fail-closed V3/V4/V5 canonical-scope
audits are deterministic exceptions: each runs one child per fixture. The
strict inline V1 producer suite runs two fresh children per fixture solely to
verify semantic digest stability. None may report statistical performance
ratios.

The independent statistical unit is a fresh process, not an inner repeat.
Therefore the report first reduces repeats inside each process to a median, then
reports the median and range of the five process-level values. With only five
independent processes, no cross-process p95 is claimed for the formal suites.
The machine was not otherwise
quiesced during the formal WASM run, and its absolute values show visible host
load variance. A release gate must run on the repository's named, controlled
benchmark host.

### Corpus

The table uses the native Rito/source-byte scope. The WASM harness joins
multiple stylesheet strings with one newline, so its synthetic `cssBytes` is
one byte larger for book-06 and book-10; no rule or declaration is added.

| Fixture | Chapter                       |    XHTML |         Active CSS | Elements | Active rules | Styled projection nodes |
| ------- | ----------------------------- | -------: | -----------------: | -------: | -----------: | ----------------------: |
| book-01 | `Text/Section003.xhtml`       | 97,361 B | 14,020 B / 1 sheet |    1,212 |          134 |                   3,565 |
| book-06 | `Text/Section_0006.xhtml`     | 55,084 B | 1,979 B / 2 sheets |      674 |           26 |                   2,013 |
| book-10 | `OEBPS/Text/Section012.xhtml` | 86,740 B | 6,874 B / 2 sheets |      920 |           37 |                   2,758 |

The broader smoke corpus contains 10 books, 290 chapters, and 4 configurations,
with 43,040 elements, 1,219 external rules, 44,998 rule matches, and 128,141
styled nodes. The three chapters above were chosen to cover a large element/rule
case, a publication with several stylesheets but a small active subset, and a
second large chapter. They are not a universal EPUB distribution.

## Correctness results

The micro-suite has 20 hand-reviewed cases at 1280×720 and observes one target's
computed `font-size` with a tolerance below 0.001 px.
Cases expecting the 16 px baseline set `html, body { font-size: 16px }`
explicitly rather than relying on a user-agent `medium` preference.

| Area                                    | Cases | Examples                                                                               |
| --------------------------------------- | ----: | -------------------------------------------------------------------------------------- |
| Selector parsing, matching, specificity |     9 | `:is`, `:not`, `:where`, `:nth-child`, sibling, attribute flags, invalid selector/list |
| Cascade                                 |     4 | `!important`, inline declarations, source order, cascade layers                        |
| Inheritance and computed values         |     5 | `em`, `inherit`, inherited custom properties, fallback, cycles                         |
| Media queries                           |     2 | true and false viewport branches                                                       |

| Engine                    | Passed |
| ------------------------- | -----: |
| Current Rust resolver     |   4/20 |
| Stylo 0.19 through Blitz  |  20/20 |
| Direct Stylo 0.19 adapter |  20/20 |

The separate V2 gate passes **6/6** typed-contract cases covering the EPUB UA
profile, author override, HTML `dir` inheritance and namespace isolation,
writing mode, text/paint/box projection, and line-height computed distinctions.
It is likewise a selected smoke gate, not a CSS conformance percentage.

This is not a claim that Stylo has “100% CSS accuracy.” The 20-case micro-suite
observes only `font-size`; even the separate V2 scope covers only 21 selected
typed fields. Neither exercises the full XHTML/box-generation, layout,
pagination, painting, or pixel contract or has a complete browser/WPT oracle.
It provides direct evidence that the current hand-written resolver has
material gaps in these selected high-risk branches and that Stylo is a much
stronger candidate for independent validation.

The production conformance program must bind each supported behavior to the CSS
specification and a fixed WPT expectation where applicable. The
[Web Platform Tests repository](https://github.com/web-platform-tests/wpt) is a
cross-browser test corpus, not the specification itself. Chromium and WebKit
should be independent differential oracles, while Firefox is useful but not
independent of Stylo. Any browser disagreement must be resolved against the
relevant specification and WPT expectation, not by majority vote.

## Historical native timing baseline

This table is the earlier `native-suite.json` baseline. Its Stylo column is the
Stylo/Blitz probe, not the direct `rito-stylo` adapter measured above; it is
retained for provenance and must not be used to claim a direct-adapter ratio.
All values are milliseconds. “Repeat” is the median of the five per-process
medians. The Stylo/Blitz probe retains its document/style session while current
Rust and TypeScript rebuild their styled output, so Stylo's absolute column is
diagnostic rather than an apples-to-apples ratio.

| Fixture | Current Rust first | TS first | Current/TS | Stylo first | Current Rust repeat | TS repeat | Current/TS | Stylo repeat |
| ------- | -----------------: | -------: | ---------: | ----------: | ------------------: | --------: | ---------: | -----------: |
| book-01 |             151.58 |    23.19 |      6.44× |       0.486 |              145.76 |     15.97 |      9.25× |        0.271 |
| book-06 |              39.44 |    14.12 |      2.76× |       0.425 |               37.95 |      8.74 |      4.34× |        0.196 |
| book-10 |              66.03 |    21.19 |      3.11× |       0.397 |               64.08 |     13.83 |      4.64× |        0.253 |

Each ratio is the median of five matched process-run ratios, not the quotient
of the two displayed independently rounded medians.

The geometric mean of the per-fixture current/TS ratios in that historical run
is 3.81× for first style and 5.71× for repeat resolve. The direct adapter now
demonstrates similar engine headroom without Blitz, but an eligible
same-work/full-projection benchmark must still prove how much survives the
complete Rito contract.

### Exploratory sibling-sharing ablation

`SelectorTarget.previous_sibling` previously owned a recursively cloned
`Box<SelectorTarget>` chain. Building sibling targets and walking selectors
therefore copied the entire prefix repeatedly, producing quadratic allocation
traffic. It now uses shared `Arc<SelectorTarget>` links.

The exploratory before/after run showed 1.85–4.05× faster full resolve across
the three fixtures, and CPU sampling no longer showed the recursive clone stack.
The historical raw samples were not retained, so those values are classified as
an ablation observation rather than part of the formal result artifact. The
change is covered by selector tests and real EPUB parity for all three benchmark
books.

The fact that one ownership fix produced a multi-fold change shows that current
performance contains significant avoidable work and allocation; it does not by
itself apportion every remaining CPU cycle.

## Same-boundary WASM results

Both probes export the same function shape:

```text
style_digest(body_html, css, viewport_width, viewport_height) -> u32
```

Both include JS-to-WASM string copy, fresh document-tree/CSS parsing, style
resolution, and an observable digest. Current Rust additionally materializes
the full Rito styled/text tree; Stylo hashes primary element styles. Values
below are process medians in milliseconds.

| Fixture | Current instantiate + first | Stylo instantiate + first | Directional ratio | Current subsequent fresh doc | Stylo subsequent fresh doc | Directional ratio |
| ------- | --------------------------: | ------------------------: | ----------------: | ---------------------------: | -------------------------: | ----------------: |
| book-01 |                      137.16 |                     46.97 |             2.97× |                       111.07 |                       5.01 |            22.09× |
| book-06 |                       52.37 |                     42.44 |             1.23× |                        33.65 |                       3.22 |            10.18× |
| book-10 |                       78.32 |                     41.45 |             1.83× |                        57.71 |                       4.26 |            13.03× |

Here too, each ratio is the median of matched process-run ratios rather than a
division of the displayed medians.

The geometric mean directional ratio is 1.88× for instantiate plus first call
and 14.31× for subsequent fresh-document calls. Stylo's larger module costs
more to instantiate: its individual instantiate medians were 7.09–7.59 ms,
versus 0.63–1.53 ms for the isolated legacy probe. Its style work more than
recovers that cost in the tested calls.

For book-01, the 100-call and 1,000-call Stylo probes both stabilized at 17.875
MiB of WASM linear memory. The 1,000-call run produced a stable digest, 3.575 ms
subsequent median, 4.454 ms p95 over 999 calls, and a 7.148 ms maximum. This is
evidence against unbounded per-call linear-memory growth in the probe; it is not
a retained-document open/close leak test for the future production adapter.

## WASM size and build cost

Sizes are from the exact artifacts in the size report. Gzip uses Node zlib at
level 9 on the post-wasm-bindgen module.

| Artifact                        | Raw Cargo WASM | Post-bindgen |      Gzip-9 |
| ------------------------------- | -------------: | -----------: | ----------: |
| Control boundary                |       35,878 B |     19,138 B |     7,801 B |
| Isolated current resolver probe |      468,452 B |    428,653 B |   160,752 B |
| Stylo + Blitz probe             |    8,822,891 B |  7,881,869 B | 2,261,381 B |
| Current complete Rito           |    6,965,011 B |  6,298,852 B | 3,241,182 B |

The Stylo/Blitz probe minus the control is 7,862,731 B post-bindgen and
2,253,580 B gzip. Compared with the isolated legacy probe, the probe difference
is 7,453,216 B post-bindgen and 2,100,629 B gzip.

Neither number is a production delta. Blitz brings its HTML parser and DOM,
Taffy integration, text/font stack, images, resources, events, and its Stylo
adapter. A direct Rito adapter will share some dependencies and delete the old
engine; link-time dead-code elimination and monomorphization also change the
result. The only product-relevant size number will be:

```text
integrated Rito with direct Stylo and no legacy resolver
minus
current integrated Rito
```

The direct adapter is now integrated and the recorded post-`wasm-bindgen`
module measures **12,348,822 B** and **4,889,655 B gzip**. That historical
artifact still included the compatibility implementation, so it is not the
current default product graph or the final “legacy removed” delta described
above. The default build now physically excludes legacy parser/cascade/cache,
but its WASM size must be remeasured before claiming any reduction or passing
the release-size gate.

Cold guarded build observations were:

- Stylo/Blitz WASM probe: 3m13s, 1,953.5 MiB peak process-tree RSS;
- isolated legacy WASM probe: 1m13s, 909.4 MiB;
- initial native Stylo spike: 4m22s, approximately 1.82 GiB.

These are one-run build observations, not distributions. Every subsequent
build and benchmark in this investigation was serialized and guarded by a 3
GiB sampled ceiling. No process from the failed sandboxed monitor attempt remained
running.

## Why the former default hand-written Rust resolver was slow

Rust is executing substantially more work than the TypeScript reference.

### 1. Full rule scan for every element

`apply_cascade` scans every rule for every element. Matching calls
`parse_selector_parts`, which rebuilds allocating `String`/`Vec` structures on
every attempted match. The main path is approximately `O(E × R)` before pseudo
elements and declaration computation.

The TypeScript reference builds a rightmost-selector rule index and asks for
id/class/tag candidates. Blink documents the same browser-engine pattern:
stylesheets are compiled and partitioned, and the right-most compound selector
chooses an id/class/tag map so irrelevant rules never reach full selector
matching. See [Blink CSS style calculation](https://chromium.googlesource.com/chromium/src/%2B/master/third_party/blink/renderer/core/css/style-calculation.md).

### 2. Pseudo elements scan the rule table twice per host

Every block/inline host checks both `::before` and `::after`; each check loops
over the full rule list even when the publication contains no generated
content. With `H` host elements, this adds approximately `2 × H × R` rule visits
to the main `E × R` scan.

### 3. Dynamic style maps are deeply cloned

Each element starts from a cloned `serde_json::Map<String, Value>`. Text nodes
also own full style maps, inherited-style construction clones and resets maps,
and matched declarations allocate more maps and strings. The TypeScript
reference frequently shares object references where current Rust owns copies.
The 10-book smoke corpus has 128,141 styled nodes for 43,040 elements, so text
and synthetic-node duplication is significant.

### 4. Parsed work is discarded and repeated

Compiled stylesheet summaries retain parsed declarations, but the cascade path
keeps raw strings and reparses matched declarations for context-dependent
font-size resolution and again for final merge. UA rules are also rebuilt on
the resolve path. A production engine should compile selectors and declaration
tokens once, then compute only values that actually depend on parent, root,
viewport, or custom-property context.

### 5. Retained-state algorithms are missing

Current Rust and TypeScript rebuild a complete styled tree for repeated
resolution. Browser engines retain a stylist, indexed rules, computed-style
sharing, dirty bits, and invalidation state. Page turns should normally reuse
the already-resolved chapter and page frames; a theme/viewport change should
invalidate the smallest safe subtree or revision, not reparse selectors and
clone every style map.

## Why Stylo instead of continuing self-development

### Why not “cleanly copy” Stylo's algorithms

There is no isolated selector-speed algorithm that can be copied once and then
forgotten. Stylo's rule indexes, selector matching, cascade, computed-value
types, custom-property substitution, style sharing, invalidation, generated
property code, and lifetime rules are designed together. Copying only the hot
matcher would leave Rito responsible for the correctness work around it;
copying enough of the surrounding machinery to preserve behavior and
performance would create a source-level Stylo fork under a different module
layout.

That fork would have to continuously reconcile upstream CSS specification and
WPT changes, parser/property schema changes, performance work, soundness and
security fixes, and applicable license/source obligations. A one-time port
would immediately begin to drift, while periodically recopying code would be a
manual rebase with weaker provenance and review tooling. Rewriting the same
ideas independently avoids copying code but not the engineering burden, and it
also gives up the exact implementation whose correctness and performance were
measured here.

The cleaner boundary is behavioral, not source-level: keep the Rito-owned,
DOM-free `SourceArena` and output projection, implement Stylo's host-tree traits
in the private adapter, pin the upstream crate, and make upgrades explicit.
When a measured EPUB blocker cannot be handled in Rito's pagination/projection
layers, prefer a focused upstream contribution or a small, traceable patch set.
Broad algorithm replication should be evaluated as a permanent fork, with the
same staffing and synchronization requirements, not described as a free way to
avoid a DOM dependency.

### Options considered

| Option                                                    | Advantages                                                                             | Costs and risks                                                                                                                                                                                                                | Decision                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Continue expanding current resolver                       | Full control; smallest theoretical binary; already integrated                          | Must recreate selector grammar, cascade, variables, media queries, namespaces, computed values, rule indexes, sharing, invalidation, WPT maintenance, and security fixes; currently slower than TS and 4/20 in the micro-suite | Reject as the primary CSS path                                               |
| Compose `cssparser` + `selectors` and keep custom cascade | Reuses parsing/matching primitives; smaller initial dependency surface                 | Still leaves most browser CSS semantics and all computed-style/invalidation architecture to Rito                                                                                                                               | Useful only inside a deliberately limited engine, not for “highest accuracy” |
| Pin upstream Stylo with a direct adapter                  | Browser-grade semantics; Rust-native; large measured headroom; upstream standards work | 0.x/internal embedding API, substantial host-tree traits, unsafe invariants, bundle and lifecycle work                                                                                                                         | Selected; now operating as the strict production resolver                    |
| Fork Stylo                                                | Maximum patch/control freedom                                                          | Rito becomes downstream of Servo's downstream of mozilla-central; permanent sync, security, license, and staffing burden                                                                                                       | Do not fork now                                                              |
| Ship Blitz                                                | Fastest proof of concept; working Stylo adapter                                        | Pulls a second DOM and broad layout/font/resource stack; 7.88 MB post-bindgen probe; overlapping architecture                                                                                                                  | Same-family integration reference/probe only                                 |
| Embed Blink or WebKit                                     | Strong browser compatibility                                                           | Large C++ engine, DOM/layout entanglement, unsuitable Rito/WASM ownership and package model                                                                                                                                    | Browser oracle only                                                          |

Blink and WebKit are open source, but their style systems are coupled to their
own DOM, lifecycle, and layout engines. Stylo is the practical reusable boundary
because it is already published as Rust crates and exposes generic host-tree
traits (named DOM traits upstream) rather than requiring a browser DOM. The
tradeoff is that this embedding surface is not a stable high-level API.

The [Stylo synchronization documentation](https://github.com/servo/stylo/blob/main/SYNCING.md)
shows that Servo imports a filtered mozilla-central history and rebases its
patches. Forking it now would make Rito responsible for maintaining a downstream
of a downstream before a blocking upstream requirement has even been found.

### Direct Stylo pros

- The Stylo/Blitz probe passes the selected modern-selector, cascade-layer,
  `!important`, custom-property, inheritance, and media-query cases; the
  production direct adapter must independently re-pass them.
- Compiled selector maps and retained style state address the measured
  algorithmic problem rather than micro-optimizing the full scan.
- Rito continues to own EPUB parsing, XHTML semantics, user settings, fonts,
  layout, pagination, paint, navigation, locators, and runtime scheduling.
- Standards evolution and most CSS correctness/security work stay with the
  Firefox/Servo ecosystem.
- The adapter can expose a small typed projection tailored to Rito rather than
  the current JSON map on every node.
- Upstream pinning keeps upgrades explicit and reproducible without committing
  to a permanent engine fork.

### Direct Stylo cons

- The adapter is real infrastructure, not a wrapper function. Stylo's host-tree
  traits require node traversal, attributes/namespaces, style data, dirty state,
  and carefully documented unsafe operations; the upstream trait names use
  “DOM,” but no browser DOM is introduced.
- Rito EPUB content is XHTML/XML, while the Blitz spike parses HTML. A
  production `SourceArena` must preserve QName, namespace, case, `xml:lang`,
  and namespaced attributes.
- Stylo's crates are 0.x and mostly implementation details; pinned upgrades can
  break the adapter.
- A direct adapter may still increase WASM download and instantiation time.
- CSS computed values must be projected into a lossless Rito-owned typed
  contract without leaking Stylo types or coupling layout to a browser DOM;
  reproducing the old 76-slot shape is explicitly not the goal.
- Global preferences, font metrics, generated content, paged-media behavior,
  and style-data destruction need explicit lifecycle tests.
- Stylo has global preferences and optional parallel traversal machinery. The
  adapter must define one ownership/threading model, keep WASM traversal
  sequential unless threads/shared memory are separately enabled and tested,
  and prove that concurrent documents cannot leak preferences or style data.
- Stylo cannot fix incorrect first-frame locator restoration, eager pagination,
  cache misses, main-thread scheduling, or dropped animation frames by itself.

## Proposed integration boundary

```text
EPUB chapter XHTML bytes
        |
        v  parse exactly once
rito-source: immutable SourceArena (stable NodeId links)
        |
        +-- Arc --> rito-core semantic tree / locators / interaction
        |
        +-- Arc --> private Stylo host-tree facade
                         +
                  mutable style-data/snapshot sidecar
                         |
                         v
                  retained Stylist
                         |
                         v
             typed Rito ComputedStyleProjection / StyleId sharing
                         |
                         v
             existing layout -> pagination -> paint -> runtime frame cache
```

Rules:

- Put the adapter in an isolated private crate/module; no public exports.
- Keep `rito-source` independent of Stylo, layout, Canvas, browser APIs, and
  JavaScript; it is the canonical source topology for every consumer.
- Preserve the current parser/style/layout/render/runtime boundaries.
- Layout remains Canvas-free and cannot depend on Stylo types.
- Share one immutable `SourceArena` with `Arc`; neither core nor the style
  adapter may reparse XHTML or clone a second source topology.
- Put Stylo dirty bits, snapshots, and element style data in a separate
  controlled mutable sidecar. Do not copy ancestor/sibling target graphs.
- Store shared `StyleId`/typed computed values and materialize only the fields
  required by layout or paint.
- Compile author and UA stylesheets once per document/revision.
- Retain Stylo style data across page turns and explicitly invalidate on theme,
  font, viewport, or user-setting changes.
- Isolate every unsafe trait method with a written safety invariant and focused
  tests.
- Keep Blitz out of the production `cargo tree`.

## Production acceptance gates

“Rust must have a step-function advantage” becomes an enforceable gate rather
than an assumption.

### Correctness

- Existing 20-case suite: 20/20 as a smoke gate. Before production, every
  expected result is bound to a specification clause, WPT case, or documented
  differential observation. This selected-suite result is never reported as a
  conformance percentage.
- The 76-row historical-slot disposition ledger closes every row through a
  typed projection, derived/used-value view, semantic attribute, or Rito-owned
  supplement. Separately, a versioned EPUB CSS/profile assertion matrix reports
  `pass`, `fail`, `unsupported`, `crash`, and `timeout`; unsupported assertions
  stay in the denominator. Neither artifact is a “76/76 accuracy” score. Every
  required profile behavior has zero unapproved
  fail/unsupported/crash/timeout; optional behavior requires an explicit public
  limitation and approved roadmap.
- A versioned EPUB CSS profile fixes the WPT commit, applicable-test manifest,
  CSS specification revisions, production adapter revision, browser versions,
  and normalization rules. Results report overall and per-module
  `pass / applicable assertions`; fail/unsupported/crash/timeout all stay in
  the denominator, required-profile unapproved failures are zero, and
  crash/timeout are zero.
- The 10-book corpus has either exact approved parity or a documented,
  standards-backed intentional correction at every difference.
- Chromium and WebKit provide differential observations for that fixed EPUB CSS
  profile; Firefox is recorded as a same-engine-family cross-check. Differences
  are decided by the specification/WPT expectation rather than browser
  majority.
- The profile runs through the shared production `SourceArena` and direct
  adapter with real `application/xhtml+xml`, not `HtmlDocument::from_html`.
  Tests assert that core and Stylo retain the same arena identity rather than
  reparsing. XHTML namespace, XML case sensitivity, `xml:lang`, namespaced
  attributes, generated content, writing modes, breaks, and paged-media cases
  are explicit.
- Existing book parity and layout/render/pixel goldens are regression gates, not
  standards-accuracy scores. Exact parity is required only where the baseline
  already agrees with the specification/WPT/browser evidence; otherwise a
  standards-backed correction is the expected result.

### Same-work performance

Performance ratios are eligible only after three independent prerequisites
pass: (1) canonical-scope correctness, including audited topology and bit-exact
declared values; (2) same-work input eligibility, including byte-identical UA,
source-ordered author styles, and either complete media capability parity or a
fixed-workload inventory proving that unsupported media features are absent;
and (3) the fixed full production projection consumed by layout and paint. Only then
measure a direct adapter that produces the same versioned Rito node/style
contract as current Rust and TypeScript. Native and post-bindgen WASM results
are reported and must pass separately; a native pass cannot substitute for a
WASM pass. On the controlled named host:

- median `resolve + Rito projection` at least **5× faster than optimized current
  Rust** on every benchmark chapter;
- geometric mean at least **3× faster than TypeScript**, with no fixture slower
  than TypeScript;
- retained repeat `resolve + projection` median no more than **5 ms**, p95 no
  more than **10 ms** after at least 100 independent process/session samples;
- WASM `instantiate + first usable style` median no more than **50 ms**, p95 no
  more than **75 ms**;
- confidence intervals and p95 are computed at the independent process/session
  level, never by flattening inner calls; the p95 upper confidence bound must
  also pass.
- The optimized-current baseline commit and binary/source hashes are fixed
  before comparison. Separate workloads cover retained no-op, local
  invalidation, and viewport/theme full invalidation.
- The browser-facing suite also runs on one named constrained/low-power device;
  it may impose stricter absolute latency limits, and may not regress any ratio
  or usability gate below its stated threshold.

The present V5 workload passes its fixed-input same-work gate, but topology,
canonical scope, and full projection still fail; each chapter also has only one
deterministic correctness run. The historical n=5 directional suite is a
different non-equivalent workload and cannot establish the required eligible
cross-process p95 confidence bound.

### Bundle, memory, and build

- Production dependency tree contains no Blitz.
- After deleting the legacy resolver, integrated post-bindgen raw WASM grows by
  at most 4 MiB. The engineering target for compressed JS+WASM runtime payload
  growth is 1.5 MiB; **2 MiB is the release-blocking hard maximum**. Reports fix
  the gzip/Brotli implementation, version, quality/window parameters, and
  include JS glue as well as WASM.
- Under identical fixture and call sequences, the integrated candidate minus
  integrated baseline steady-state WASM linear-memory delta is at most 32 MiB.
  The same run reports WASM linear memory, JavaScript heap, and process RSS;
  none is attributed to CSS from a non-integrated probe.
- Twenty open/close cycles and 1,000 restyles show no unbounded retained growth;
  memory after stabilization changes by at most 10%.
- At least two independent documents repeatedly resolve, update viewport/theme,
  cancel work, and destroy their sidecars concurrently: no panic, use-after-free,
  data race, setting/style bleed, or retained-growth breach. Native adapter
  stress tests run under the available sanitizers; browser tests cover separate
  workers. WASM stays sequential unless its threads/shared-memory build passes
  an equivalent gate.
- All CI/local build commands default to bounded parallelism. Local runs retain
  the 250 ms sampled 3 GiB process-tree tripwire; CI/release runs should add an
  OS/container-enforced memory limit. The ceiling remains 3 GiB until repeated
  data justifies changing it.
- On the named CI host, a clean direct-adapter WASM build completes within five
  minutes and below the 3 GiB limit; an incremental adapter-only rebuild
  completes within one minute. Both are measured distributions before release,
  not inferred from this spike's one-run observations.
- Non-test adapter code stays below 2,000 lines unless an explicit architecture
  review approves more; every unsafe block has a safety invariant.
- Two consecutive upstream-version upgrade rehearsals each take no more than
  two engineer-days and change no more than 10% of adapter lines.
- All directly used Stylo-family crates are pinned to one reviewed version
  family. RustSec/`cargo audit`, source provenance, license policy, immutable
  source archival, and SBOM checks are release gates. Routine upgrade review is
  at least quarterly; a critical advisory is triaged within 48 hours and has a
  shipped fix or documented mitigation within seven days (faster for an active
  exploit).
- Legal review must determine and satisfy the notice and source-availability
  obligations for all distributed MPL Covered Software, including the concrete
  MPL-2.0/AGPL-3.0-only combination and any Secondary License markings. Any
  Blitz adapter code copied rather than independently implemented retains its
  actually applicable MIT/Apache attribution.

### Reader experience

CSS acceptance cannot substitute for reader acceptance:

- Cold open includes EPUB read/decode, CSS, fonts needed for the first frame,
  layout, correct locator restoration, and frame publication. On the named
  corpus it must be at least 2× faster in median than the TypeScript baseline,
  with p95 no more than 1 second.
- An initial locator is applied before the first committed visible frame; page
  1 must never be shown as the initialized reader state when another locator is
  supplied.
- That assertion covers every supported locator/anchor kind at chapter start,
  middle, and tail; single/double-page views; representative viewports and
  writing modes; delayed fonts; and cached/uncached initialization. The oracle
  inspects the first committed frame, not a later corrective jump.
- A cached page-turn starts responding within 50 ms p95 and has its target frame
  ready for animation within 100 ms p95. The configured animation may complete
  later; readiness must not be faked by shortening or removing it.
- Page-turn animation remains enabled for its specified duration; animation
  frame time stays within the actual display refresh budget at p99, dropped
  frames remain below 1%, and no page turn introduces a main-thread task longer
  than 50 ms on the named device. Duration, trajectory, and first animation
  frame are fixed comparison inputs; none may be shortened or removed to pass.
- A TOC jump acknowledges input within 50 ms p95. For already loaded content,
  the target frame is visible within 250 ms p95; background growth must never
  block input for seconds.
- In the stress gate, 10 TOC jumps issued within one second are cancellable and
  latest-wins. Stale work may neither publish an old target nor delay
  acknowledgement of the newest input; for loaded content the final target is
  visible within 500 ms of the last input. For uncached local EPUB content,
  navigation/loading feedback appears within 100 ms and the final latest target
  is visible within 1 second p95 on the named corpus. A newer jump cancels stale
  parsing, pagination, and publication work; an old result can never overwrite
  it.
- Current-frame rendering, navigation feedback, and animation run independently
  from background pagination/revision warming.

These gates directly cover the reported “卡、慢、翻页延迟、目录快速跳转数秒后才响应”
failures and prevent a CSS migration from being mistaken for the whole fix.

## Fork policy

The following conditions trigger a fork review; none automatically authorizes
a permanent fork:

1. A required capability cannot be implemented in the adapter, UA stylesheet,
   or Rito projection; a focused upstream change is rejected or receives no
   resolution for 90 days.
2. The integrated bundle misses the hard size gate by at least 20%, profiling
   attributes at least 70% of the excess to removable Stylo paths, and upstream
   declines feature gating across two releases.
3. Two consecutive minor upgrades each require more than five engineer-days or
   change more than 20% of adapter lines.
4. At least three P0/P1 EPUB correctness requirements intentionally diverge
   from web CSS semantics and cannot live in Rito's pagination/layout layer.
5. A reproducible performance blocker exceeding 20%, measured against the last
   accepted version on the fixed benchmark host, has no usable upstream fix
   within 60 days. Security and soundness issues use the emergency advisory SLA
   above and can justify a temporary hotfix immediately; they do not wait 60 or
   90 days.
6. Upstream has no meaningful maintenance/release activity for 180 days while
   Rito has an active blocker.

A temporary security/soundness hotfix branch is allowed, with an upstream fix
submitted and a plan to return to the pinned upstream release. API churn alone
triggers a pin/upgrade review, not a fork. A permanent fork requires a named
owner, recurring sync automation, an explicit exit/return-upstream plan, and at
least 0.25 FTE of maintenance budget. Its default governance ceiling is one
upstream release or 90 days of non-security lag (whichever comes first) and
5,000 changed non-test/non-vendored downstream lines; different limits require
an approved staffing and risk analysis before the fork decision. Otherwise
pinning an older safe version or changing engines is more responsible than
creating an unmaintained browser-engine fork.

## Execution sequence

1. Keep broad feature work frozen in the diagnostics-only compatibility
   resolver; do not reconnect it to default production.
2. Keep the namespace-aware, structure-immutable `rito-source::SourceArena` as
   the single XHTML parse topology shared by core and the private direct Stylo
   adapter; extend only the adapter's mutable style sidecar.
3. Close the V5 topology-ledger gaps: reconcile the legacy `html`/`body`
   root-carrier and canonical-parent integration model, then project `br`
   hard-break conversion to a declared direct equivalent. Continue recording
   actual producer events keyed by source `NodeId`; never approve topology from
   a tag whitelist.
4. Use `InlineFormattingStyleV1` as the first versioned migration slice, then
   add explicit omitted-property and consumer-equivalence gates while closing
   the remaining 76-slot dispositions. Build the canonical layout/paint
   projection actually required by consumers; do not reproduce the old
   76-slot object shape or use per-node JSON maps in the production path.
5. Establish the fixed spec/WPT profile and Chromium/WebKit differential
   validation; resolve intentional differences.
6. After canonical-scope, same-work, and full-projection eligibility pass, run
   native and WASM benchmarks with at least 100 independent samples on the
   controlled host.
7. Keep the pinned corpus gate on the strict resolver, require zero legacy
   linkage/cache initialization in default products, keep every bounded layout
   subset explicit, and run the full reader usability gate with animation
   enabled.
8. Retain/cache `StyleDocument` sessions across reflow/restyle, implement
   targeted invalidation, and repeat book-scale latency and memory runs.
9. Remeasure the default integrated WASM bundle after the physical legacy gate
   and continue reducing it against the release threshold.
10. Keep `legacy-css-diagnostics` isolated as a parity/forensics tool while it
    remains useful; removing its source entirely is a separate archival
    decision and must not affect strict production error semantics.

## Final answer to the rewrite question

The Rust rewrite is valuable because it can unify the cross-platform core,
own memory and state explicitly, retain native engine structures, and eliminate
JavaScript hot-path/boundary work. The former hand-written resolver did not
deliver the required CSS advantage because it used worse algorithms and much
heavier allocation patterns. The recorded integrated Stylo-first Book10 run
shows a **6.963× style-path speedup** and **1.396× end-to-end wall speedup**, with
25/25 Stylo resolutions and zero fallbacks. The broader pinned corpus now
routes 290/290 chapters through Stylo with zero automatic legacy fallbacks, so
the migration has demonstrated a material production-path advantage rather
than only an isolated microbench.

Continuing to hand-build a browser-grade CSS engine would spend the rewrite
budget recreating infrastructure that Stylo already maintains, while still
leaving pagination, locator restoration, frame caching, and animation work
unfinished. The evidence supports using upstream Stylo through a direct Rito
adapter, not forking Stylo and not shipping Blitz. The default product has
since physically removed legacy parser/cascade/cache from its build graph and
made Stylo rejection a typed error. The direct adapter must still earn release
completion through canonical correctness, full consumer coverage,
retained-session performance, WASM size, safety, visual-golden, and reader-level
gates. In particular, the CSS gain alone does not solve initial-position,
pagination scheduling, frame caching, page-turn, or rapid-navigation latency.
