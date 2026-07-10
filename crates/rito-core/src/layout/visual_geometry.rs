use serde_json::Value;

use super::content::RuntimeBlock;

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
struct AffineTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct VisualGeometry {
    matrix: AffineTransform,
    clip: Option<VisualRect>,
}

impl VisualGeometry {
    pub(crate) const fn page() -> Self {
        Self {
            matrix: AffineTransform::IDENTITY,
            clip: None,
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
        if paint
            .get("clipToBounds")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
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
        Self { matrix, clip }
    }

    pub(crate) fn resolve_rect(self, rect: VisualRect) -> Option<VisualRect> {
        let transformed = self.matrix.transform_rect(rect);
        match self.clip {
            Some(clip) if clip.width == 0.0 || clip.height == 0.0 => None,
            Some(clip) => intersect_rects(transformed, clip),
            None => Some(transformed),
        }
    }
}

impl Default for VisualRect {
    fn default() -> Self {
        Self::new(0.0, 0.0, 0.0, 0.0)
    }
}

impl AffineTransform {
    const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    fn translation(dx: f64, dy: f64) -> Self {
        Self {
            e: dx,
            f: dy,
            ..Self::IDENTITY
        }
    }

    fn from_json(value: &Value, box_width: f64, box_height: f64) -> Option<Self> {
        let transform = value.as_object()?;
        match transform.get("kind")?.as_str()? {
            "rotate" => {
                let radians = transform.get("rad")?.as_f64()?;
                let (sin, cos) = radians.sin_cos();
                Some(Self {
                    a: cos,
                    b: sin,
                    c: -sin,
                    d: cos,
                    e: 0.0,
                    f: 0.0,
                })
            }
            "scale" => Some(Self {
                a: transform.get("sx")?.as_f64()?,
                b: 0.0,
                c: 0.0,
                d: transform.get("sy")?.as_f64()?,
                e: 0.0,
                f: 0.0,
            }),
            "translate" => Some(Self::translation(
                resolve_length_pct(transform.get("x")?, box_width)?,
                resolve_length_pct(transform.get("y")?, box_height)?,
            )),
            _ => None,
        }
    }

    fn multiply(self, right: Self) -> Self {
        Self {
            a: self.a * right.a + self.c * right.b,
            b: self.b * right.a + self.d * right.b,
            c: self.a * right.c + self.c * right.d,
            d: self.b * right.c + self.d * right.d,
            e: self.a * right.e + self.c * right.f + self.e,
            f: self.b * right.e + self.d * right.f + self.f,
        }
    }

    fn transform_rect(self, rect: VisualRect) -> VisualRect {
        let points = [
            self.transform_point(rect.x, rect.y),
            self.transform_point(rect.x + rect.width, rect.y),
            self.transform_point(rect.x, rect.y + rect.height),
            self.transform_point(rect.x + rect.width, rect.y + rect.height),
        ];
        let left = points
            .iter()
            .map(|point| point.0)
            .fold(f64::INFINITY, f64::min);
        let top = points
            .iter()
            .map(|point| point.1)
            .fold(f64::INFINITY, f64::min);
        let right = points
            .iter()
            .map(|point| point.0)
            .fold(f64::NEG_INFINITY, f64::max);
        let bottom = points
            .iter()
            .map(|point| point.1)
            .fold(f64::NEG_INFINITY, f64::max);
        VisualRect::new(left, top, right - left, bottom - top)
    }

    fn transform_point(self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }
}

fn resolve_length_pct(value: &Value, basis: f64) -> Option<f64> {
    let value = value.as_object()?;
    let number = value.get("value")?.as_f64()?;
    match value.get("unit")?.as_str()? {
        "percent" => Some(number / 100.0 * basis),
        "px" => Some(number),
        _ => None,
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
mod tests {
    use serde_json::json;

    use super::{VisualGeometry, VisualRect};
    use crate::layout::content::RuntimeBlock;

    #[test]
    fn applies_offset_transform_and_clip_in_parent_space() {
        let block = RuntimeBlock::<()> {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
            semantic_tag: None,
            anchor_id: None,
            paint: Some(json!({
                "visualOffset": { "dx": 5, "dy": -2 },
                "transform": [{ "kind": "scale", "sx": 2, "sy": 1 }],
                "clipToBounds": true,
            })),
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            children: Vec::new(),
        };
        let visual = VisualGeometry::page().enter_block(&block, 10.0, 20.0);

        assert_eq!(
            visual.resolve_rect(VisualRect::new(10.0, 20.0, 20.0, 10.0)),
            Some(VisualRect::new(-35.0, 18.0, 40.0, 10.0))
        );
        assert_eq!(
            visual.resolve_rect(VisualRect::new(-100.0, -100.0, 10.0, 10.0)),
            None
        );
    }

    #[test]
    fn resolves_percentage_translation_against_block_size() {
        let block = RuntimeBlock::<()> {
            x: 0.0,
            y: 0.0,
            width: 80.0,
            height: 40.0,
            semantic_tag: None,
            anchor_id: None,
            paint: Some(json!({
                "transform": [{
                    "kind": "translate",
                    "x": { "unit": "percent", "value": 25 },
                    "y": { "unit": "px", "value": 3 },
                }],
            })),
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            children: Vec::new(),
        };
        let visual = VisualGeometry::page().enter_block(&block, 0.0, 0.0);

        assert_eq!(
            visual.resolve_rect(VisualRect::new(1.0, 2.0, 3.0, 4.0)),
            Some(VisualRect::new(21.0, 5.0, 3.0, 4.0))
        );
    }
}
