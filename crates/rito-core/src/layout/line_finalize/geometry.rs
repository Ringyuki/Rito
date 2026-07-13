use super::super::line::LineRun;

#[derive(Debug, Default)]
pub(super) struct PendingLineGeometry {
    pub(super) index: usize,
    pub(super) line_width: f64,
    min_top: f64,
    max_bottom: f64,
    ruby_overhang: f64,
    pub(super) height: f64,
    pub(super) y_shift: f64,
}

impl PendingLineGeometry {
    pub(super) fn accumulate_metrics(&mut self, run: &LineRun) {
        let Some((top, bottom, ruby)) = run_metrics(run) else {
            return;
        };
        if top < self.min_top {
            self.min_top = top;
        }
        if bottom > self.max_bottom {
            self.max_bottom = bottom;
        }
        if ruby > self.ruby_overhang {
            self.ruby_overhang = ruby;
        }
    }

    pub(super) fn finish(&mut self, base_line_height: f64) {
        let content_height = base_line_height.max(self.max_bottom - self.min_top);
        self.height = content_height + self.ruby_overhang;
        self.y_shift = if self.min_top < 0.0 {
            -self.min_top
        } else {
            0.0
        } + self.ruby_overhang;
    }
}

fn run_metrics(run: &LineRun) -> Option<(f64, f64, f64)> {
    match run {
        LineRun::Text(run) => {
            let (top, bottom) = if let Some(line_height_px) = run.line_height_px {
                let half_leading = (run.font_size - line_height_px) / 2.0;
                let top = run.y + half_leading;
                (top, top + line_height_px)
            } else {
                (run.y, run.y + run.height)
            };
            let ruby = run
                .ruby_annotation
                .as_ref()
                .map(|_| run.font_size * 0.5 + 1.0)
                .unwrap_or(0.0);
            Some((top, bottom, ruby))
        }
        LineRun::Atom(run) => Some((run.y, run.y + run.height, 0.0)),
        LineRun::Ruby(_) => None,
    }
}
