use std::convert::Infallible;

use super::line_break::Utf16Text;

#[cfg(test)]
use std::cell::Cell;

const SHORT_PREFIX_FAST_PATH_UTF16: usize = 256;

pub(super) fn should_probe_bounded(utf16_units: usize) -> bool {
    utf16_units > SHORT_PREFIX_FAST_PATH_UTF16
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    match try_find_fitting_prefix(text, start, end, max_width, monotonic_widths, &mut |end| {
        Ok::<f64, Infallible>(measure_width(end))
    }) {
        Ok(fitting) => fitting,
        Err(error) => match error {},
    }
}

pub(super) fn try_find_fitting_prefix<F, E>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    monotonic_widths: bool,
    measure_width: &mut F,
) -> Result<FittingPrefix, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    if !should_probe_bounded(end.saturating_sub(start))
        || !monotonic_widths
        || !max_width.is_finite()
    {
        return try_find_fitting_prefix_from_end(text, start, end, max_width, measure_width);
    }
    // The first overflow is a valid upper bound only when appending text cannot
    // reduce the measured width. Other cases stay on the whole-suffix path.
    try_find_fitting_prefix_bounded(text, start, end, max_width, measure_width)
}

fn try_find_fitting_prefix_from_end<F, E>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    measure_width: &mut F,
) -> Result<FittingPrefix, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    if measure_width(end)? <= max_width {
        return Ok(FittingPrefix {
            position: end,
            forward_end: end,
        });
    }
    Ok(FittingPrefix {
        position: try_narrow_fitting_prefix(text, start, end, max_width, measure_width)?,
        forward_end: end,
    })
}

fn try_find_fitting_prefix_bounded<F, E>(
    text: &Utf16Text<'_>,
    start: usize,
    end: usize,
    max_width: f64,
    measure_width: &mut F,
) -> Result<FittingPrefix, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    let mut fitting = start;
    let mut distance = 1usize;
    let first_overflow = loop {
        let target = start.saturating_add(distance).min(end);
        let mut candidate = text.floor_boundary(target);
        if candidate <= fitting {
            candidate = text.next_offset(fitting).min(end);
        }
        if measure_width(candidate)? > max_width {
            break candidate;
        }
        fitting = candidate;
        if fitting >= end {
            return Ok(FittingPrefix {
                position: end,
                forward_end: end,
            });
        }
        distance = distance.saturating_mul(2);
    };
    Ok(FittingPrefix {
        position: try_narrow_fitting_prefix(
            text,
            fitting,
            first_overflow,
            max_width,
            measure_width,
        )?,
        forward_end: first_overflow,
    })
}

fn try_narrow_fitting_prefix<F, E>(
    text: &Utf16Text<'_>,
    mut fitting: usize,
    mut overflowing: usize,
    max_width: f64,
    measure_width: &mut F,
) -> Result<usize, E>
where
    F: FnMut(usize) -> Result<f64, E>,
{
    while fitting < overflowing.saturating_sub(1) {
        let midpoint = text.floor_boundary((fitting + overflowing) / 2);
        if midpoint <= fitting {
            break;
        }
        if measure_width(midpoint)? <= max_width {
            fitting = midpoint;
        } else {
            overflowing = midpoint;
        }
    }
    Ok(fitting)
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
pub(super) fn record_prefix_probe(start_utf16: usize, end_utf16: usize) {
    let utf16_units = end_utf16.saturating_sub(start_utf16);
    PREFIX_PROBE_STATS.set(PREFIX_PROBE_STATS.get().record(utf16_units));
    super::text_work_trace::record_prefix_probe(start_utf16, end_utf16);
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
