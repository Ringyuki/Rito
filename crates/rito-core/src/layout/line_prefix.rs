use super::line_break::Utf16Text;

#[cfg(test)]
use std::cell::Cell;

const SHORT_PREFIX_FAST_PATH_UTF16: usize = 256;

pub(super) fn should_probe_bounded(utf16_units: usize) -> bool {
    utf16_units > SHORT_PREFIX_FAST_PATH_UTF16
}

#[derive(Debug, Clone, Copy)]
pub(super) struct FittingPrefix {
    pub(super) position: usize,
    pub(super) forward_end: usize,
}

pub(super) fn find_fitting_prefix<F>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    monotonic_widths: bool,
    measure_width: &mut F,
) -> FittingPrefix
where
    F: FnMut(usize) -> f64,
{
    if !should_probe_bounded(end.saturating_sub(start))
        || !monotonic_widths
        || !max_width.is_finite()
    {
        return find_fitting_prefix_from_end(text, start, end, max_width, measure_width);
    }
    // The first overflow is a valid upper bound only when appending text cannot
    // reduce the measured width. Other cases stay on the whole-suffix path.
    find_fitting_prefix_bounded(text, start, end, max_width, measure_width)
}

fn find_fitting_prefix_from_end<F>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    measure_width: &mut F,
) -> FittingPrefix
where
    F: FnMut(usize) -> f64,
{
    if measure_width(end) <= max_width {
        return FittingPrefix {
            position: end,
            forward_end: end,
        };
    }
    FittingPrefix {
        position: narrow_fitting_prefix(text, start, end, max_width, measure_width),
        forward_end: end,
    }
}

fn find_fitting_prefix_bounded<F>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    measure_width: &mut F,
) -> FittingPrefix
where
    F: FnMut(usize) -> f64,
{
    let mut fitting = start;
    let mut distance = 1usize;
    let first_overflow = loop {
        let target = start.saturating_add(distance).min(end);
        let mut candidate = text.floor_boundary(target);
        if candidate <= fitting {
            candidate = text.next_offset(fitting).min(end);
        }
        if measure_width(candidate) > max_width {
            break candidate;
        }
        fitting = candidate;
        if fitting >= end {
            return FittingPrefix {
                position: end,
                forward_end: end,
            };
        }
        distance = distance.saturating_mul(2);
    };
    FittingPrefix {
        position: narrow_fitting_prefix(text, fitting, first_overflow, max_width, measure_width),
        forward_end: first_overflow,
    }
}

fn narrow_fitting_prefix<F>(
    text: &Utf16Text<'_>,
    mut fitting: usize,
    mut overflowing: usize,
    max_width: f64,
    measure_width: &mut F,
) -> usize
where
    F: FnMut(usize) -> f64,
{
    while fitting < overflowing.saturating_sub(1) {
        let midpoint = text.floor_boundary((fitting + overflowing) / 2);
        if midpoint <= fitting {
            break;
        }
        if measure_width(midpoint) <= max_width {
            fitting = midpoint;
        } else {
            overflowing = midpoint;
        }
    }
    fitting
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct PrefixProbeStats {
    pub(super) calls: usize,
    pub(super) utf16_units: usize,
    pub(super) max_probe_units: usize,
}

#[cfg(test)]
thread_local! {
    static PREFIX_PROBE_STATS: Cell<PrefixProbeStats> = Cell::new(PrefixProbeStats::default());
}

#[cfg(test)]
pub(super) fn record_prefix_probe(utf16_units: usize) {
    PREFIX_PROBE_STATS.set(PREFIX_PROBE_STATS.get().record(utf16_units));
}

#[cfg(test)]
pub(super) fn reset_prefix_probe_stats() {
    PREFIX_PROBE_STATS.set(PrefixProbeStats::default());
}

#[cfg(test)]
pub(super) fn prefix_probe_stats() -> PrefixProbeStats {
    PREFIX_PROBE_STATS.get()
}

#[cfg(test)]
impl PrefixProbeStats {
    fn record(self, utf16_units: usize) -> Self {
        Self {
            calls: self.calls + 1,
            utf16_units: self.utf16_units + utf16_units,
            max_probe_units: self.max_probe_units.max(utf16_units),
        }
    }
}

#[cfg(test)]
mod tests;
