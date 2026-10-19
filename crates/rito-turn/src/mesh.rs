//! The grids sheets are laid out on.

/// The grid a leaf is drawn with: fine enough for its bend to look smooth.
pub const COLUMNS: usize = 64;
pub const ROWS: usize = 48;
/// The grid a page curled over is drawn with: fine both ways, for its roll
/// may lie at any angle across the page.
const CURLED_COLUMNS: usize = 96;
const CURLED_ROWS: usize = 160;

/// The grid the sheets of a spread are drawn with: one page a spread is curled, two are leaves.
pub fn grid_for(spine: f64) -> (usize, usize) {
    if spine == 0.0 {
        (CURLED_COLUMNS, CURLED_ROWS)
    } else {
        (COLUMNS, ROWS)
    }
}
