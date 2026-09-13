//! Float occupancy inside one container. Tracks every float box the
//! container placed or adopted, answers where a new one lands against
//! the floats still active at its own block position, how far a line's
//! inline edges are pushed in at a given position, and how far down a
//! clearing box or the container's own seal has to go.

use crate::*;

/// A container's sealed height: the flow position or the deepest float
/// bottom, whichever is lower (the container is a flow root and contains
/// its floats).
pub(crate) fn seal_height(y: f64, floats: &FloatBands) -> f64 {
    y.max(floats.left_bottom()).max(floats.right_bottom())
}

impl FloatBands {
    pub(crate) fn new() -> Self {
        Self {
            boxes: Vec::new(),
            floor_y: f64::NEG_INFINITY,
        }
    }

    fn has_active(&self, flow_y: f64) -> bool {
        self.boxes.iter().any(|b| b.bottom > flow_y + 1e-6)
    }

    fn left_bottom(&self) -> f64 {
        self.boxes
            .iter()
            .filter(|b| !b.right_side)
            .map(|b| b.bottom)
            .fold(f64::NEG_INFINITY, f64::max)
    }

    fn right_bottom(&self) -> f64 {
        self.boxes
            .iter()
            .filter(|b| b.right_side)
            .map(|b| b.bottom)
            .fold(f64::NEG_INFINITY, f64::max)
    }

    /// Rightmost active-left-float edge at `y` (the left content limit).
    fn left_edge(&self, y: f64) -> f64 {
        self.boxes
            .iter()
            .filter(|b| !b.right_side && b.bottom > y + 1e-6)
            .map(|b| b.x0.max(b.x1))
            .fold(0.0, f64::max)
    }

    /// Leftmost active-right-float edge at `y` (the right content limit).
    fn right_edge(&self, y: f64, content_width: f64) -> f64 {
        self.boxes
            .iter()
            .filter(|b| b.right_side && b.bottom > y + 1e-6)
            .map(|b| b.x0.min(b.x1))
            .fold(content_width, f64::min)
    }

    /// The earliest y past `y` where an active box expires (the next
    /// band edge), if any.
    fn next_band_edge(&self, y: f64) -> Option<f64> {
        self.boxes
            .iter()
            .filter(|b| b.bottom > y + 1e-6)
            .map(|b| b.bottom)
            .fold(None, |lowest: Option<f64>, bottom| {
                Some(lowest.map_or(bottom, |value| value.min(bottom)))
            })
    }

    /// Seeds the bands with an ancestor's exclusion at this container's
    /// origin, so floats placed here stack beside it instead of on top.
    pub(crate) fn from_incoming(
        band: Option<rito_fragment::FloatBand>,
        content_width: f64,
    ) -> Self {
        let mut bands = Self::new();
        if let Some(band) = band {
            if band.left_inset > 0.0 {
                bands.boxes.push(PlacedFloatBox {
                    right_side: false,
                    x0: 0.0,
                    x1: band.left_inset,
                    bottom: band.bottom,
                });
            }
            if band.right_inset > 0.0 {
                bands.boxes.push(PlacedFloatBox {
                    right_side: true,
                    x0: content_width - band.right_inset,
                    x1: content_width,
                    bottom: band.bottom,
                });
            }
        }
        bands
    }

    /// Registers a float that escaped a descendant container so it keeps
    /// excluding content in this one.
    pub(crate) fn adopt(&mut self, float: rito_fragment::EscapedFloat, content_width: f64) {
        if float.right_side {
            self.boxes.push(PlacedFloatBox {
                right_side: true,
                x0: content_width - float.width,
                x1: content_width,
                bottom: float.bottom,
            });
        } else {
            self.boxes.push(PlacedFloatBox {
                right_side: false,
                x0: 0.0,
                x1: float.width,
                bottom: float.bottom,
            });
        }
        self.floor_y = self.floor_y.max(float.top);
    }

    /// The exclusion an in-flow paragraph starting at `flow_y` sees: how
    /// much inline space each side withholds, and how far down the band
    /// reaches. `None` once no float overlaps that position.
    pub(crate) fn band_at(
        &self,
        flow_y: f64,
        content_width: f64,
    ) -> Option<rito_fragment::FloatBand> {
        let bottom = self.left_bottom().max(self.right_bottom());
        if bottom <= flow_y + 1e-6 {
            return None;
        }
        let left_inset = self.left_edge(flow_y);
        let right_inset = (content_width - self.right_edge(flow_y, content_width)).max(0.0);
        if left_inset + right_inset <= 0.0 || left_inset + right_inset >= content_width {
            return None;
        }
        Some(rito_fragment::FloatBand {
            left_inset,
            right_inset,
            bottom: bottom - flow_y,
        })
    }

    pub(crate) fn bottom_for(&self, clear: Clear) -> f64 {
        match clear {
            Clear::None => f64::NEG_INFINITY,
            Clear::Left => self.left_bottom(),
            Clear::Right => self.right_bottom(),
            Clear::Both => self.left_bottom().max(self.right_bottom()),
        }
    }

    /// The band top a float of `width` would land on, starting no higher
    /// than `flow_y`, without committing anything.
    pub(crate) fn probe_y(&self, width: f64, flow_y: f64, content_width: f64) -> f64 {
        let mut y = flow_y.max(self.floor_y);
        loop {
            let left = self.left_edge(y);
            let right = self.right_edge(y, content_width);
            if right - left + 1e-6 >= width || !self.has_active(y) {
                return y;
            }
            match self.next_band_edge(y) {
                Some(edge) if edge > y => y = edge,
                _ => return y,
            }
        }
    }

    /// Places one float of `width`, starting no higher than `flow_y`.
    /// Returns the margin-box x (content-area relative) and y.
    pub(crate) fn place(
        &mut self,
        side: Float,
        width: f64,
        height: f64,
        flow_y: f64,
        content_width: f64,
    ) -> (f64, f64) {
        let y = self.probe_y(width, flow_y, content_width);
        let x = match side {
            Float::Left => self.left_edge(y),
            Float::Right | Float::None => self.right_edge(y, content_width) - width,
        };
        self.boxes.push(PlacedFloatBox {
            right_side: !matches!(side, Float::Left),
            x0: x,
            x1: x + width,
            bottom: y + height,
        });
        self.floor_y = self.floor_y.max(y);
        (x, y)
    }
}
