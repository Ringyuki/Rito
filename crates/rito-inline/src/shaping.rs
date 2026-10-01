//! The shaper's advance domain: the 16.16 fixed-point cluster advance the
//! browser's pen steps by.

/// One cluster's advance in the browser's 16.16 fixed-point pen domain:
/// scale = round(size * 65536), px = trunc(units * scale / upem) / 65536,
/// with author letter-spacing added OUTSIDE the fixed-point round trip
/// (it was folded into the cluster advance after shaping).
pub(crate) fn hb_fixed_cluster_advance<B: parley::style::Brush>(
    current: &parley::layout::Cluster<'_, B>,
    run_letter_spacing: f64,
) -> f64 {
    use skrifa::raw::TableProvider as _;
    let advance = f64::from(current.advance());
    let run = current.run();
    let font = run.font();
    let Ok(font_ref) = skrifa::FontRef::from_index(font.data.as_ref(), font.index) else {
        return advance;
    };
    let Ok(head) = font_ref.head() else {
        return advance;
    };
    let upem = i64::from(head.units_per_em());
    let size = f64::from(run.font_size());
    if upem <= 0 || size <= 0.0 {
        return advance;
    }
    let scale = (size * 65536.0).round() as i64;
    let bare = advance - run_letter_spacing;
    let units = (bare * upem as f64 / size).round() as i64;
    (units * scale / upem) as f64 / 65536.0 + run_letter_spacing
}
