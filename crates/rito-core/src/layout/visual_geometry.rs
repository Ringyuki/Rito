use serde_json::Value;

use super::content::RuntimeBlock;

mod affine;

use affine::AffineTransform;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct VisualRect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

impl VisualRect {
    pub(crate) fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct VisualGeometry {
    matrix: AffineTransform,
    clip: Option<VisualRect>,
    interaction_supported: bool,
}

impl VisualGeometry {
    pub(crate) const fn page() -> Self {
        Self {
            matrix: AffineTransform::IDENTITY,
            clip: None,
            interaction_supported: true,
        }
    }

    pub(crate) fn enter_block<Line>(
        self,
        block: &RuntimeBlock<Line>,
        absolute_x: f64,
        absolute_y: f64,
    ) -> Self {
        let Some(paint) = block.paint.as_ref().and_then(Value::as_object) else {
            return self;
        };
        let mut matrix = self.matrix;
        if let Some(offset) = paint.get("visualOffset").and_then(Value::as_object) {
            let dx = offset.get("dx").and_then(Value::as_f64).unwrap_or(0.0);
            let dy = offset.get("dy").and_then(Value::as_f64).unwrap_or(0.0);
            matrix = matrix.multiply(AffineTransform::translation(dx, dy));
        }

        if let Some(transforms) = paint
            .get("transform")
            .and_then(Value::as_array)
            .filter(|transforms| !transforms.is_empty())
        {
            let center_x = absolute_x + block.width / 2.0;
            let center_y = absolute_y + block.height / 2.0;
            matrix = matrix.multiply(AffineTransform::translation(center_x, center_y));
            for transform in transforms {
                if let Some(transform) =
                    AffineTransform::from_json(transform, block.width, block.height)
                {
                    matrix = matrix.multiply(transform);
                }
            }
            matrix = matrix.multiply(AffineTransform::translation(-center_x, -center_y));
        }

        let mut clip = self.clip;
        let clips_to_bounds = paint
            .get("clipToBounds")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if clips_to_bounds {
            let own_clip = matrix.transform_rect(VisualRect::new(
                absolute_x,
                absolute_y,
                block.width,
                block.height,
            ));
            clip = Some(match clip {
                Some(parent_clip) => intersect_rects(parent_clip, own_clip).unwrap_or_default(),
                None => own_clip,
            });
        }
        Self {
            matrix,
            clip,
            interaction_supported: self.interaction_supported
                && matrix.is_axis_aligned_and_invertible()
                && !(clips_to_bounds && paint.get("radius").is_some()),
        }
    }

    pub(crate) fn resolve_rect(self, rect: VisualRect) -> Option<VisualRect> {
        let transformed = self.matrix.transform_rect(rect);
        match self.clip {
            Some(clip) if clip.width == 0.0 || clip.height == 0.0 => None,
            Some(clip) => intersect_rects(transformed, clip),
            None => Some(transformed),
        }
    }

    pub(crate) fn supports_axis_aligned_interaction(self) -> bool {
        self.interaction_supported && self.matrix.is_axis_aligned_and_invertible()
    }

    pub(crate) fn inverse_point(self, x: f64, y: f64) -> Option<(f64, f64)> {
        self.matrix.inverse_axis_aligned_point(x, y)
    }

    pub(crate) fn resolve_vertical_segment(
        self,
        x: f64,
        y: f64,
        height: f64,
    ) -> Option<VisualRect> {
        if !self.supports_axis_aligned_interaction() {
            return None;
        }
        let top = self.matrix.transform_point(x, y);
        let bottom = self.matrix.transform_point(x, y + height);
        let x = (top.0 + bottom.0) / 2.0;
        let y = top.1.min(bottom.1);
        let bottom = top.1.max(bottom.1);
        match self.clip {
            Some(clip)
                if x < clip.x
                    || x > clip.x + clip.width
                    || bottom <= clip.y
                    || y >= clip.y + clip.height =>
            {
                None
            }
            Some(clip) => {
                let clipped_y = y.max(clip.y);
                let clipped_bottom = bottom.min(clip.y + clip.height);
                (clipped_bottom > clipped_y)
                    .then(|| VisualRect::new(x, clipped_y, 0.0, clipped_bottom - clipped_y))
            }
            None => Some(VisualRect::new(x, y, 0.0, bottom - y)),
        }
    }
}

impl Default for VisualRect {
    fn default() -> Self {
        Self::new(0.0, 0.0, 0.0, 0.0)
    }
}

fn intersect_rects(left: VisualRect, right: VisualRect) -> Option<VisualRect> {
    let x = left.x.max(right.x);
    let y = left.y.max(right.y);
    let right_edge = (left.x + left.width).min(right.x + right.width);
    let bottom = (left.y + left.height).min(right.y + right.height);
    if right_edge <= x || bottom <= y {
        return None;
    }
    Some(VisualRect::new(x, y, right_edge - x, bottom - y))
}

#[cfg(test)]
mod tests;
