#[derive(Debug, Clone)]
struct ContinuousFloatEntry {
    width: f64,
    start_y: f64,
    bottom_y: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ContinuousFloatContext {
    left: Vec<ContinuousFloatEntry>,
    right: Vec<ContinuousFloatEntry>,
}

impl ContinuousFloatContext {
    pub(crate) fn add_float(&mut self, side: &str, width: f64, start_y: f64, bottom_y: f64) {
        let entry = ContinuousFloatEntry {
            width,
            start_y,
            bottom_y,
        };
        if side == "right" {
            self.right.push(entry);
        } else {
            self.left.push(entry);
        }
    }

    pub(crate) fn clear_expired(&mut self, y: f64) {
        self.left.retain(|entry| y < entry.bottom_y);
        self.right.retain(|entry| y < entry.bottom_y);
    }

    pub(crate) fn left_width(&self, y: f64) -> f64 {
        active_float_width(&self.left, y)
    }

    pub(crate) fn right_width(&self, y: f64) -> f64 {
        active_float_width(&self.right, y)
    }

    pub(crate) fn clear_y(&self, clear: &str) -> f64 {
        let left = max_float_bottom(&self.left);
        let right = max_float_bottom(&self.right);
        match clear {
            "left" => left,
            "right" => right,
            _ => left.max(right),
        }
    }

    pub(crate) fn max_left_width_in_range(&self, from_y: f64, to_y: f64) -> f64 {
        max_float_width_in_range(&self.left, from_y, to_y)
    }

    pub(crate) fn max_right_width_in_range(&self, from_y: f64, to_y: f64) -> f64 {
        max_float_width_in_range(&self.right, from_y, to_y)
    }

    pub(crate) fn next_clearance(&self, y: f64) -> f64 {
        let mut min_bottom = f64::INFINITY;
        for entry in self.left.iter().chain(&self.right) {
            if y >= entry.start_y && y < entry.bottom_y {
                min_bottom = min_bottom.min(entry.bottom_y);
            }
        }
        if min_bottom.is_infinite() {
            y
        } else {
            min_bottom
        }
    }
}

const FLOAT_TOLERANCE: f64 = 1.0;

fn active_float_width(floats: &[ContinuousFloatEntry], y: f64) -> f64 {
    floats
        .iter()
        .filter(|entry| y >= entry.start_y && y < entry.bottom_y + FLOAT_TOLERANCE)
        .map(|entry| entry.width)
        .sum()
}

fn max_float_bottom(floats: &[ContinuousFloatEntry]) -> f64 {
    floats
        .iter()
        .map(|entry| entry.bottom_y)
        .fold(0.0_f64, f64::max)
}

fn max_float_width_in_range(floats: &[ContinuousFloatEntry], from_y: f64, to_y: f64) -> f64 {
    let mut max_width = active_float_width(floats, from_y);
    for entry in floats {
        if entry.start_y > from_y && entry.start_y < to_y {
            max_width = max_width.max(active_float_width(floats, entry.start_y));
        }
    }
    max_width
}
