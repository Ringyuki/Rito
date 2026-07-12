use serde_json::Value;

use super::VisualRect;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct AffineTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}

impl AffineTransform {
    pub(super) const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub(super) fn translation(dx: f64, dy: f64) -> Self {
        Self {
            e: dx,
            f: dy,
            ..Self::IDENTITY
        }
    }

    pub(super) fn from_json(value: &Value, box_width: f64, box_height: f64) -> Option<Self> {
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

    pub(super) fn multiply(self, right: Self) -> Self {
        Self {
            a: self.a * right.a + self.c * right.b,
            b: self.b * right.a + self.d * right.b,
            c: self.a * right.c + self.c * right.d,
            d: self.b * right.c + self.d * right.d,
            e: self.a * right.e + self.c * right.f + self.e,
            f: self.b * right.e + self.d * right.f + self.f,
        }
    }

    pub(super) fn transform_rect(self, rect: VisualRect) -> VisualRect {
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

    pub(super) fn transform_point(self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }

    pub(super) fn is_axis_aligned_and_invertible(self) -> bool {
        approximately_zero(self.b)
            && approximately_zero(self.c)
            && self.a.is_finite()
            && self.d.is_finite()
            && self.e.is_finite()
            && self.f.is_finite()
            && !approximately_zero(self.a)
            && !approximately_zero(self.d)
    }

    pub(super) fn inverse_axis_aligned_point(self, x: f64, y: f64) -> Option<(f64, f64)> {
        self.is_axis_aligned_and_invertible()
            .then_some(((x - self.e) / self.a, (y - self.f) / self.d))
    }
}

fn approximately_zero(value: f64) -> bool {
    value.abs() <= 1e-12
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
