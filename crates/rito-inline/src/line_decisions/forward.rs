//! The line edges decided one line at a time, the way Blink decides them
//! while it breaks each line (`ShapingLineBreaker::ShapeLine`): a line is
//! broken, its edge decides (a pair trim it separates, a pending line-end
//! trim confirmed or rejected, a ruby split rewound or spread, a closer the
//! line extends by, an item rewound), the line is broken again with the
//! decision until nothing more is decided, and the next line follows. No
//! decision reaches back to an earlier line.
//!
//! The paragraph is built once; its lines are broken on a copy whose
//! cluster advances take each decision as the build would (the spacing a
//! byte carries under the decided edits, from the build's spacing plan).
//! It is then built once more with the edits decided, and its lines must
//! end where the copy's did.

use std::collections::{BTreeMap, HashMap};
use std::ops::Range;

use super::*;

/// The edits and forced line ends a paragraph's lines decided: the line-end
/// trims and suppressed pair trims sorted, the split spreads as decided.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct LineEdits {
    end_trims: Vec<usize>,
    suppressed_pair_trims: Vec<usize>,
    split_spreads: Vec<(Range<usize>, f32)>,
    forced: BTreeMap<usize, usize>,
}

impl LineEdits {
    pub(crate) fn edits(&self) -> ParagraphEdits<'_> {
        ParagraphEdits {
            end_trims: &self.end_trims,
            suppressed_pair_trims: &self.suppressed_pair_trims,
            split_spreads: &self.split_spreads,
        }
    }

    pub(crate) fn forced(&self) -> Vec<(usize, usize)> {
        self.forced
            .iter()
            .map(|(line, end)| (*line, *end))
            .collect()
    }

    /// Whether a build under `other` is a build under these edits.
    fn builds_as(&self, other: &Self) -> bool {
        self.end_trims == other.end_trims
            && self.suppressed_pair_trims == other.suppressed_pair_trims
            && self.split_spreads == other.split_spreads
    }
}

/// How many spaces a build keeps its decided line edges for: a resize
/// passes through many, a reader returns to a few.
const KEPT_DECISIONS: usize = 4;

/// The line edges a build decided in each space it was laid out in, and
/// the inline sizes the deciding pass's comparisons hold for, shared by
/// every copy of the build. A paragraph laid out again in a space it was
/// decided in replays them instead of deciding again.
#[derive(Default)]
pub(crate) struct KeptDecisions {
    kept: std::cell::RefCell<Vec<(BreakKey, LineEdits, WidthBounds)>>,
}

impl KeptDecisions {
    fn get(&self, key: &BreakKey) -> Option<(LineEdits, WidthBounds)> {
        let mut kept = self.kept.borrow_mut();
        let index = kept.iter().position(|(kept_key, ..)| kept_key == key)?;
        let entry = kept.remove(index);
        let found = (entry.1.clone(), entry.2);
        kept.push(entry);
        Some(found)
    }

    fn keep(&self, key: BreakKey, edits: LineEdits, bounds: WidthBounds) {
        let mut kept = self.kept.borrow_mut();
        kept.retain(|(kept_key, ..)| *kept_key != key);
        if kept.len() == KEPT_DECISIONS {
            kept.remove(0);
        }
        kept.push((key, edits, bounds));
    }
}

fn insert_sorted(values: &mut Vec<usize>, value: usize) {
    if let Err(at) = values.binary_search(&value) {
        values.insert(at, value);
    }
}

fn remove_sorted(values: &mut Vec<usize>, value: usize) {
    if let Ok(at) = values.binary_search(&value) {
        values.remove(at);
    }
}

/// A line's end as the copy broke it, which the build must reproduce.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LineEnd {
    range: Range<usize>,
    reason: parley::layout::BreakReason,
}

/// What a line's edge decided.
enum Decision {
    /// A pair trim the break separates (its left byte).
    Suppress(usize),
    /// The pending line-end trim (its byte) the line did not end after.
    Reject(usize),
    /// The line rewound to end before a text index (a split ruby base's
    /// segment that cannot fit its annotation).
    Force(usize),
    /// Split ruby segments spread on the line.
    Spread(Vec<(Range<usize>, f32)>),
    /// A closer the line extends by, and the suppressed pairs it puts back
    /// on one line.
    Trim { byte: usize, unsuppress: Vec<usize> },
}

/// The paragraph a decision pass runs over and what it reads.
struct Pass<'a> {
    context: &'a ParleyInlineContext,
    inputs: &'a LineEdgeInputs<'a>,
    source: &'a ParagraphLayout,
    /// The edits `source` was built with.
    source_edits: &'a LineEdits,
    trims_possible: bool,
}

impl ParleyInlineContext {
    /// The paragraph at `inputs.root` built with its line edges decided and
    /// broken into its lines; every comparison a decision made is recorded
    /// in `bounds`.
    pub(crate) fn decide_line_edges(
        &self,
        inputs: &LineEdgeInputs<'_>,
        bounds: &mut WidthBounds,
    ) -> Result<DecidedParagraph, LayoutError> {
        let LineEdgeInputs {
            tree,
            root,
            space,
            cancel,
            ..
        } = *inputs;
        let mut source_edits = LineEdits::default();
        let mut source =
            self.shaped_paragraph(tree, root, space, ParagraphEdits::default(), cancel)?;
        // The base build keeps what each space it was laid out in decided:
        // laid out there again, the paragraph decides nothing and builds
        // only what is kept.
        let kept = std::rc::Rc::clone(&source.kept_decisions);
        let key = BreakKey::new(space, inputs.band, &[]);
        if let Some((decided, decided_bounds)) = kept.get(&key) {
            bounds.intersect(&decided_bounds);
            let mut built = if decided.builds_as(&source_edits) {
                source
            } else {
                self.shaped_paragraph(tree, root, space, decided.edits(), cancel)?
            };
            self.break_decided(inputs, &mut built, &decided.forced(), bounds);
            return Ok(decided_paragraph(built));
        }
        let mut pass_bounds = WidthBounds::new(space.inline_size);
        // A pass over a build whose lines broke elsewhere than its copy's
        // runs once more over that build, at most twice; then the build's
        // own lines stand.
        for attempt in 0..3 {
            let trims_possible = *source.line_end_trims.get_or_init(|| {
                line_end_trims_possible(&self.catalog, &source.layout, &source.text)
            });
            let decides = !source.pair_trims.is_empty()
                || !source.ruby_annotation_widths.is_empty()
                || trims_possible;
            let pass = Pass {
                context: self,
                inputs,
                source: &source,
                source_edits: &source_edits,
                trims_possible,
            };
            // Most paragraphs break into lines that decide nothing: those
            // stand as the build broke them, and a pass decides only from
            // the first line that does.
            let first = if decides {
                pass.first_decision(&mut pass_bounds)
            } else {
                None
            };
            let (decided, ends) = match first {
                Some(first) => {
                    let (decided, ends) = pass.decide(&mut pass_bounds, first)?;
                    (decided, Some(ends))
                }
                None => (source_edits.clone(), None),
            };
            let mut built = if decided.builds_as(&source_edits) {
                source.clone()
            } else {
                self.shaped_paragraph(tree, root, space, decided.edits(), cancel)?
            };
            self.break_decided(inputs, &mut built, &decided.forced(), bounds);
            let ends_match = ends.is_none_or(|ends| {
                built
                    .layout
                    .lines()
                    .map(|line| LineEnd {
                        range: line.text_range(),
                        reason: line.break_reason(),
                    })
                    .eq(ends)
            });
            if ends_match || attempt == 2 {
                bounds.intersect(&pass_bounds);
                kept.keep(key, decided, pass_bounds);
                return Ok(decided_paragraph(built));
            }
            source = built;
            source_edits = decided;
        }
        unreachable!("the last attempt returns")
    }

    /// Breaks `built` into its lines with `forced` ends, recording each
    /// line's fit (and what pins the width) in `bounds`.
    fn break_decided(
        &self,
        inputs: &LineEdgeInputs<'_>,
        built: &mut ParagraphLayout,
        forced: &[(usize, usize)],
        bounds: &mut WidthBounds,
    ) {
        let LineEdgeInputs { space, band, .. } = *inputs;
        built.kept_breaks.break_or_restore(
            &mut built.layout,
            BreakKey::new(space, band, forced),
            |layout| {
                #[cfg(test)]
                self.counts.note_break();
                break_paragraph_lines(layout, space, band, forced);
            },
        );
        if built.reads_space {
            bounds.pin();
        }
        let mut line_top = 0.0_f64;
        for (index, line) in built.layout.lines().enumerate() {
            record_line_fit(
                bounds,
                space,
                band,
                &line,
                line_top,
                if index == 0 {
                    built.first_line_indent
                } else {
                    0.0
                },
            );
            line_top += f64::from(line.metrics().line_height);
        }
    }
}

/// Records a line's fit against the max advance the breaker gave it, and
/// pins the width when a band leaves the line no room.
fn record_line_fit(
    bounds: &mut WidthBounds,
    space: &ConstraintSpace,
    band: Option<rito_fragment::FloatBand>,
    line: &parley::layout::Line<'_, [u8; 4]>,
    line_top: f64,
    indent: f32,
) {
    if let Some(band) = band.filter(|band| line_inside_band(line_top, *band)) {
        if space.inline_size - band.left_inset - band.right_inset <= 0.0 {
            bounds.pin();
        }
    }
    let limit =
        (f64::from(line_max_advance(space, band, line_top)) + LINE_FIT_EPSILON) as f32 - indent;
    let (floor, ceiling) = line.fit_range();
    bounds.fit_range(f64::from(floor), f64::from(ceiling), f64::from(limit));
}

fn decided_paragraph(built: ParagraphLayout) -> DecidedParagraph {
    DecidedParagraph {
        layout: built.layout,
        alignment: built.alignment,
        shifted_ranges: built.shifted_ranges,
        first_line_indent: built.first_line_indent,
        ruby_spreads: built.ruby_spreads,
        ruby_spread_overhangs: built.ruby_spread_overhangs,
        ruby_spread_overhangs_right: built.ruby_spread_overhangs_right,
        ruby_center_shifts: built.ruby_center_shifts,
        opener_halt_trims: built.opener_halt_trims,
        inline_block_boxes: built.inline_block_boxes,
        inline_block_baselines: built.inline_block_baselines,
        image_edge_insets: built.image_edge_insets,
        empty_box_struts: built.empty_box_struts,
        spacing_edits: built.spacing_edits,
        cluster_steps: built.cluster_steps,
    }
}

/// The decisions under way.
struct State {
    edits: LineEdits,
    rejected: Vec<usize>,
    pending: Option<usize>,
    /// Each overwritten cluster's advance in the source build.
    originals: HashMap<usize, f32>,
}

impl Pass<'_> {
    /// The first line of the source broken as its edits break it that
    /// decides anything, when one does; every comparison is recorded in
    /// `bounds`, so a paragraph whose lines decide nothing stands as broken.
    fn first_decision(&self, bounds: &mut WidthBounds) -> Option<usize> {
        let mut scanned = self.source.clone();
        self.context.break_decided(
            self.inputs,
            &mut scanned,
            &self.source_edits.forced(),
            bounds,
        );
        let mut state = State {
            edits: self.source_edits.clone(),
            rejected: Vec::new(),
            pending: None,
            originals: HashMap::new(),
        };
        let mut line_top = 0.0_f64;
        for (index, line) in scanned.layout.lines().enumerate() {
            if self
                .decide_line(&scanned.layout, index, line_top, 0, &mut state, bounds)
                .is_some()
            {
                return Some(index);
            }
            line_top += f64::from(line.metrics().line_height);
        }
        None
    }

    /// Breaks the source's lines one at a time on a copy, deciding each
    /// line's edge from line `first` on (the lines before it decide
    /// nothing): the edits and forced ends decided, and where each line
    /// ended.
    fn decide(
        &self,
        bounds: &mut WidthBounds,
        first: usize,
    ) -> Result<(LineEdits, Vec<LineEnd>), LayoutError> {
        #[cfg(test)]
        self.context.counts.note_pass();
        let LineEdgeInputs {
            space,
            band,
            cancel,
            ..
        } = *self.inputs;
        let mut state = State {
            edits: self.source_edits.clone(),
            rejected: Vec::new(),
            pending: None,
            originals: HashMap::new(),
        };
        let mut copy = self.source.layout.clone();
        let mut breaker = copy.break_lines();
        breaker
            .state_mut()
            .set_layout_max_advance((space.inline_size + LINE_FIT_EPSILON) as f32);
        let mut ends = Vec::new();
        let mut line_top = 0.0_f64;
        let line_bound = self.source.text.len() + self.source.layout.inline_boxes().len() + 1;
        // Decisions a line may take before it stands as broken: each one
        // finalizes the line further, so real paragraphs stay far below.
        const LINE_DECISION_LIMIT: usize = 64;
        loop {
            if cancel.is_cancelled() {
                return Err(LayoutError::Cancelled);
            }
            let index = ends.len();
            let start = breaker.state().clone();
            let mut spread_rounds = 0_u32;
            let mut decisions = 0_usize;
            let line_end = loop {
                breaker.revert_to(start.clone());
                set_next_line_width(&mut breaker, space, band);
                let broken = match state.edits.forced.get(&index) {
                    Some(&end) => breaker.break_next_to(end).is_some(),
                    None => breaker.break_next().is_some(),
                };
                if !broken {
                    break None;
                }
                // Read before the tentative next line: reverting past the
                // last line clears it, and the breaker would then commit
                // empty lines for ever.
                let last = breaker.is_done();
                let after = breaker.state().clone();
                if index < first {
                    // Broken exactly as the source broke it: it decides
                    // nothing, and its fit is recorded.
                    break breaker.inspect(|layout| {
                        layout.get(index).map(|line| {
                            (
                                LineEnd {
                                    range: line.text_range(),
                                    reason: line.break_reason(),
                                },
                                f64::from(line.metrics().line_height),
                                last,
                            )
                        })
                    });
                }
                set_next_line_width(&mut breaker, space, band);
                let _ = breaker.break_next();
                let decision = breaker.inspect(|layout| {
                    self.record_fits(bounds, layout, index, line_top);
                    if decisions >= LINE_DECISION_LIMIT {
                        return None;
                    }
                    self.decide_line(layout, index, line_top, spread_rounds, &mut state, bounds)
                });
                let Some(decision) = decision else {
                    let end = breaker.inspect(|layout| {
                        layout.get(index).map(|line| {
                            (
                                LineEnd {
                                    range: line.text_range(),
                                    reason: line.break_reason(),
                                },
                                f64::from(line.metrics().line_height),
                                last,
                            )
                        })
                    });
                    breaker.revert_to(after);
                    break end;
                };
                decisions += 1;
                if matches!(decision, Decision::Spread(_)) {
                    spread_rounds += 1;
                }
                self.apply(decision, index, &mut state, &mut breaker);
            };
            let Some((end, height, last)) = line_end else {
                break;
            };
            ends.push(end);
            line_top += height;
            if last {
                break;
            }
            // Every line holds a cluster or a box but an empty last one, so
            // more lines than that mean the breaking went wrong: stop rather
            // than lay lines out for ever.
            if ends.len() > line_bound {
                return Err(LayoutError::Invalid(format!(
                    "line decisions broke {} lines out of {line_bound} possible",
                    ends.len()
                )));
            }
        }
        drop(breaker);
        Ok((state.edits, ends))
    }

    /// Records the fits of line `index` and the tentative line after it.
    fn record_fits(
        &self,
        bounds: &mut WidthBounds,
        layout: &parley::Layout<[u8; 4]>,
        index: usize,
        line_top: f64,
    ) {
        let LineEdgeInputs { space, band, .. } = *self.inputs;
        let mut top = line_top;
        for at in index..(index + 2).min(layout.len()) {
            let Some(line) = layout.get(at) else {
                break;
            };
            let indent = if at == 0 {
                self.source.first_line_indent
            } else {
                0.0
            };
            record_line_fit(bounds, space, band, &line, top, indent);
            top += f64::from(line.metrics().line_height);
        }
    }

    /// What line `index`'s edge decides, in the order the decisions take
    /// one another into account: a pair the break separates, the pending
    /// trim, a ruby split rewound, split segments spread, a closer the line
    /// extends by, an item rewound.
    fn decide_line(
        &self,
        layout: &parley::Layout<[u8; 4]>,
        index: usize,
        line_top: f64,
        spread_rounds: u32,
        state: &mut State,
        bounds: &mut WidthBounds,
    ) -> Option<Decision> {
        let LineEdgeInputs { space, band, .. } = *self.inputs;
        let line = layout.get(index)?;
        let next = layout.get(index + 1);
        let text = &self.source.text;
        let plan = &self.source.spacing_plan;
        let edits = state.edits.edits();
        // A pair a line break separates keeps both glyphs at full width,
        // exactly as the browser trims within lines only.
        if let Some(next) = &next {
            if let Some(trim) = plan.applied_pair_ending_at(next.text_range().start, edits) {
                return Some(Decision::Suppress(trim.left_byte));
            }
        }
        if let Some(byte) = state.pending {
            let trimmed_end = byte + text[byte..].chars().next().map_or(1, char::len_utf8);
            let confirmed = line.text_range().end == trimmed_end
                || next
                    .as_ref()
                    .is_some_and(|next| next.text_range().end == trimmed_end);
            if !confirmed {
                return Some(Decision::Reject(byte));
            }
            state.pending = None;
        }
        let indent = if index == 0 {
            self.source.first_line_indent
        } else {
            0.0
        };
        let forced = state.edits.forced.contains_key(&index);
        let last = next.is_none();
        if !forced && !last && !self.source.ruby_annotation_widths.is_empty() {
            let max_advance =
                f64::from(line_max_advance(space, band, line_top) - indent) + LINE_FIT_EPSILON;
            if let Some(end) = self.ruby_split_rewind(layout, &line, max_advance, bounds) {
                return Some(Decision::Force(end));
            }
        }
        if spread_rounds < 2 && !self.source.ruby_annotation_widths.is_empty() {
            let spreads = self.split_spreads(layout, &line, &state.edits.split_spreads);
            if !spreads.is_empty() {
                return Some(Decision::Spread(spreads));
            }
        }
        if forced || last || !self.trims_possible {
            return None;
        }
        // The line-end extension measures openers whose pair a break
        // suppressed back in their mid-line (trimmed) form.
        let suppressed_openers = self.suppressed_openers(&state.edits, &line, next.as_ref());
        let max_advance =
            line_max_advance(space, band, line_top) + LINE_FIT_EPSILON as f32 - indent;
        let decided = |byte: usize| {
            state.edits.end_trims.binary_search(&byte).is_ok() || state.rejected.contains(&byte)
        };
        line_end_trim_candidate(
            &self.context.catalog,
            layout,
            text,
            index,
            max_advance,
            decided,
            &suppressed_openers,
            bounds,
        )
        .map(|(byte, unsuppress)| Decision::Trim { byte, unsuppress })
    }

    /// The (opener byte, pair left byte) of each suppressed opener-halt pair
    /// whose opener the candidate scan past this line may reach.
    fn suppressed_openers(
        &self,
        edits: &LineEdits,
        line: &parley::layout::Line<'_, [u8; 4]>,
        next: Option<&parley::layout::Line<'_, [u8; 4]>>,
    ) -> Vec<(usize, usize)> {
        let text = &self.source.text;
        let from = line.text_range().start;
        let to = next.map_or(line.text_range().end, |next| next.text_range().end);
        let suppressed = &edits.suppressed_pair_trims;
        let first = suppressed.partition_point(|left| *left < from);
        suppressed[first..]
            .iter()
            .take_while(|left| **left < to)
            .filter_map(|&left_byte| {
                let left = text[left_byte..].chars().next()?;
                let right_byte = left_byte + left.len_utf8();
                let right = text[right_byte..].chars().next()?;
                (cjk_punctuation_trim(left, right) == Some(TrimmedGlyph::Right))
                    .then_some((right_byte, left_byte))
            })
            .collect()
    }

    /// The item containing byte `at` strictly inside it, if a text item
    /// does: items tile the flow text in order.
    fn item_around(&self, at: usize) -> Option<usize> {
        let ranges = self.inputs.item_text_ranges;
        let index = ranges.partition_point(|range| range.end <= at);
        ranges
            .get(index)
            .is_some_and(|range| range.start < at && at < range.end)
            .then_some(index)
    }

    /// Ruby split-fit: a soft break inside a ruby base is legal only while
    /// the first segment still fits carrying its WHOLE annotation — the
    /// segment widens to at least the annotation's advance (measured:
    /// 608px of text plus 异 at 16px fit a 627.2px line, but the segment
    /// carries Talent at 23px and Blink sends the ruby down; 黄金妖|精
    /// stays split because 黄金妖 at 48px covers Leprechaun's 44px). An
    /// overflowing split rewinds the line to the item start.
    fn ruby_split_rewind(
        &self,
        layout: &parley::Layout<[u8; 4]>,
        line: &parley::layout::Line<'_, [u8; 4]>,
        max_advance: f64,
        bounds: &mut WidthBounds,
    ) -> Option<usize> {
        if line.break_reason() != parley::layout::BreakReason::Regular {
            return None;
        }
        let range = line.text_range();
        let item = self.item_around(range.end)?;
        let annotation_width = *self.source.ruby_annotation_widths.get(&item)?;
        let item_range = self.inputs.item_text_ranges[item].clone();
        let item_start = item_range.start;
        // The split's first segment must START on this line; a base already
        // split earlier has nothing to rewind.
        if item_start < range.start {
            return None;
        }
        let text = &self.source.text;
        let mut segment_advance = 0.0_f64;
        let mut cluster = parley::layout::Cluster::from_byte_index(layout, item_start);
        while let Some(current) = cluster {
            if current.text_range().start >= range.end {
                break;
            }
            segment_advance += f64::from(current.advance());
            cluster = current.next_logical();
        }
        // A multi-word annotation splits at its spaces and only the words
        // allocated to THIS segment (by character-midpoint position) must
        // fit over it — 正|规勇者 under "Legal Brave" keeps the split
        // because 正 carries only Legal (measured matrix).
        let segment_annotation_width = match self.annotation_text(item) {
            Some(annotation) => {
                let total_chars = text
                    .get(item_range.clone())
                    .map_or(0, |base| base.chars().count());
                let segment_chars = text
                    .get(item_start..range.end)
                    .map_or(0, |segment| segment.chars().count());
                if total_chars == 0 {
                    annotation_width
                } else {
                    let ratio = segment_chars as f64 / total_chars as f64;
                    let allocated = rito_fragment::allocate_ruby_annotation(annotation, 0.0, ratio);
                    if allocated == annotation {
                        annotation_width
                    } else if allocated.is_empty() {
                        0.0
                    } else {
                        // Approximate the allocated words' advance by
                        // character share — exact enough for the fit
                        // decision, and both ends stay measurement-free.
                        annotation_width * allocated.chars().count() as f64
                            / annotation.chars().count().max(1) as f64
                    }
                }
            }
            None => annotation_width,
        };
        // The segment's box presses its allocated annotation's advance on
        // the line, minus the RUBY's own spread overhang — an unspread ruby
        // (annotation narrower than the whole base) overhangs nothing, so
        // its full allocated advance presses (measured: 异/Talent rewinds at
        // 19.875 where the segment-local half-excess would have squeaked
        // by; spread 咒/Thaumaturgy keeps its split at 42.95 − 2.74).
        let overhang = self
            .source
            .ruby_spread_overhangs
            .get(&item)
            .copied()
            .unwrap_or(0.0);
        let segment_box = (segment_annotation_width - overhang).max(segment_advance);
        if segment_box <= segment_advance + LINE_FIT_EPSILON {
            return None;
        }
        let metrics = line.metrics();
        let natural = f64::from(metrics.advance) - f64::from(metrics.trailing_whitespace);
        if bounds.fits(natural - segment_advance + segment_box, max_advance) {
            return None;
        }
        (item_start > range.start).then_some(item_start)
    }

    /// A ruby base SPLIT across lines spreads each on-line segment to its
    /// allocated annotation words' advance (measured on a walk-mirrored
    /// page: 'Leprechaun' over the split 黄金|妖精 spreads the first
    /// segment's 黄 to a 21.77px box — 16 + excess/(2·n) space-around
    /// shares — while the whole-base test saw a narrow annotation and left
    /// it packed): the spreads this line's split segments take.
    fn split_spreads(
        &self,
        layout: &parley::Layout<[u8; 4]>,
        line: &parley::layout::Line<'_, [u8; 4]>,
        decided: &[(Range<usize>, f32)],
    ) -> Vec<(Range<usize>, f32)> {
        let text = &self.source.text;
        let line_range = line.text_range();
        let ranges = self.inputs.item_text_ranges;
        let mut spreads: Vec<(Range<usize>, f32)> = Vec::new();
        // Only a base the line splits qualifies (whole bases took the
        // shaping-time spread law already): the items across its start and
        // its end.
        let mut items: Vec<usize> = [
            self.item_around(line_range.start),
            self.item_around(line_range.end),
        ]
        .into_iter()
        .flatten()
        .collect();
        items.dedup();
        for item in items {
            let Some(annotation_width) = self.source.ruby_annotation_widths.get(&item).copied()
            else {
                continue;
            };
            let item_range = ranges[item].clone();
            let seg_start = item_range.start.max(line_range.start);
            let seg_end = item_range.end.min(line_range.end);
            if seg_end <= seg_start {
                continue;
            }
            if decided
                .iter()
                .chain(spreads.iter())
                .any(|(range, _)| range.start == seg_start)
            {
                continue;
            }
            let Some(annotation_text) = self.annotation_text(item) else {
                continue;
            };
            let total_chars = text
                .get(item_range.clone())
                .map_or(0, |base| base.chars().count());
            if total_chars == 0 {
                continue;
            }
            let before = text
                .get(item_range.start..seg_start)
                .map_or(0.0, |t| t.chars().count() as f64);
            let through = text
                .get(item_range.start..seg_end)
                .map_or(0.0, |t| t.chars().count() as f64);
            let allocated = rito_fragment::allocate_ruby_annotation(
                annotation_text,
                before / total_chars as f64,
                if seg_end >= item_range.end {
                    f64::INFINITY
                } else {
                    through / total_chars as f64
                },
            );
            if allocated.is_empty() {
                continue;
            }
            let allocated_width = annotation_width * allocated.chars().count() as f64
                / annotation_text.chars().count().max(1) as f64;
            let mut segment_advance = 0.0_f64;
            let mut cluster = parley::layout::Cluster::from_byte_index(layout, seg_start);
            while let Some(current) = cluster {
                if current.text_range().start >= seg_end {
                    break;
                }
                segment_advance += f64::from(current.advance());
                cluster = current.next_logical();
            }
            let excess = allocated_width - segment_advance;
            if excess <= 0.01 {
                continue;
            }
            let seg_chars = text
                .get(seg_start..seg_end)
                .map_or(0, |t| t.chars().count());
            if seg_chars == 0 {
                continue;
            }
            let n = seg_chars as f64;
            let gap = excess / n;
            let last_cluster_start = text
                .get(seg_start..seg_end)
                .and_then(|t| t.char_indices().next_back())
                .map_or(seg_start, |(offset, _)| seg_start + offset);
            if seg_chars >= 2 && last_cluster_start > seg_start {
                spreads.push((seg_start..last_cluster_start, gap as f32));
            }
            // Edge share carried by the segment's last cluster (half a
            // share per side).
            spreads.push((last_cluster_start..seg_end, (excess / (2.0 * n)) as f32));
        }
        spreads
    }

    fn annotation_text(&self, item: usize) -> Option<&str> {
        let FormattingNodeContent::InlineFlow { items } =
            &self.inputs.tree.node(self.inputs.root).content
        else {
            return None;
        };
        match items.get(item) {
            Some(InlineItem::Text {
                ruby_annotation: Some(annotation),
                ..
            }) => Some(annotation.text.as_str()),
            _ => None,
        }
    }

    /// Takes `decision` for line `index`, overwriting the copy's advances
    /// of every cluster whose spacing it changes.
    fn apply(
        &self,
        decision: Decision,
        index: usize,
        state: &mut State,
        breaker: &mut parley::BreakLines<'_, [u8; 4]>,
    ) {
        let plan = &self.source.spacing_plan;
        let mut touched: Vec<usize> = Vec::new();
        match decision {
            Decision::Suppress(left) => {
                insert_sorted(&mut state.edits.suppressed_pair_trims, left);
                state.edits.forced.remove(&index);
                touched.extend(plan.pair_edit_start(left));
            }
            Decision::Reject(byte) => {
                remove_sorted(&mut state.edits.end_trims, byte);
                state.rejected.push(byte);
                state.pending = None;
                touched.push(byte);
            }
            Decision::Force(end) => {
                state.edits.forced.insert(index, end);
            }
            Decision::Spread(spreads) => {
                let text = &self.source.text;
                for (range, _) in &spreads {
                    touched.extend(
                        text[range.clone()]
                            .char_indices()
                            .map(|(at, _)| range.start + at),
                    );
                }
                state.edits.split_spreads.extend(spreads);
            }
            Decision::Trim { byte, unsuppress } => {
                insert_sorted(&mut state.edits.end_trims, byte);
                for left in unsuppress {
                    remove_sorted(&mut state.edits.suppressed_pair_trims, left);
                    touched.extend(plan.pair_edit_start(left));
                }
                state.pending = Some(byte);
                state.edits.forced.remove(&index);
                touched.push(byte);
            }
        }
        let text = &self.source.text;
        let source_edits = self.source_edits.edits();
        for byte in touched {
            let Some(cluster) = breaker.inspect(|layout| layout.cluster_starting_at(byte)) else {
                continue;
            };
            let original = *state
                .originals
                .entry(cluster)
                .or_insert_with(|| breaker.cluster_advance(cluster));
            let edits = state.edits.edits();
            let spacing = plan.letter_spacing_at(text, byte, edits)
                - plan.letter_spacing_at(text, byte, source_edits);
            let halt = plan.halt_half_at(byte, source_edits).unwrap_or(0.0)
                - plan.halt_half_at(byte, edits).unwrap_or(0.0);
            breaker.set_cluster_advance(cluster, original + spacing + halt);
        }
    }
}
