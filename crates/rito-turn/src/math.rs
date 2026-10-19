//! Arithmetic as the page turn is told in: the same bits on every host.
//!
//! Transcendental functions go through `libm`, one implementation for wasm
//! and native alike. The helpers that stand for JavaScript's own (`Math.max`
//! propagating NaN, `Math.round` rounding halves up, `Math.sign(0)` being 0,
//! `x || 1`) keep the semantics the turn was first written with.

pub(crate) use core::f64::consts::PI;

pub(crate) fn sin(x: f64) -> f64 {
    libm::sin(x)
}

pub(crate) fn cos(x: f64) -> f64 {
    libm::cos(x)
}

pub(crate) fn tan(x: f64) -> f64 {
    libm::tan(x)
}

pub(crate) fn asin(x: f64) -> f64 {
    libm::asin(x)
}

pub(crate) fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

pub(crate) fn exp(x: f64) -> f64 {
    libm::exp(x)
}

pub(crate) fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

pub(crate) fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}

/// The larger, or NaN when either is; +0 is larger than -0.
pub(crate) fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() {
            b
        } else {
            a
        }
    } else if a > b {
        a
    } else {
        b
    }
}

/// The smaller, or NaN when either is; -0 is smaller than +0.
pub(crate) fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `value` kept within `low`..=`high`, as `min(high, max(low, value))` keeps it.
pub(crate) fn clamp(value: f64, low: f64, high: f64) -> f64 {
    min(high, max(low, value))
}

/// `x`, or 1 where it is zero or NaN: a length divided by.
pub(crate) fn or_one(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        1.0
    } else {
        x
    }
}

/// Hermite smooth step of `value` from `from` to `to`.
pub(crate) fn smoothstep(from: f64, to: f64, value: f64) -> f64 {
    let t = clamp((value - from) / (to - from), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_semantics() {
        assert!(max(f64::NAN, 1.0).is_nan());
        assert!(min(1.0, f64::NAN).is_nan());
        assert_eq!(or_one(0.0), 1.0);
        assert_eq!(or_one(f64::NAN), 1.0);
        assert_eq!(or_one(3.0), 3.0);
        assert!(max(0.0, -0.0).is_sign_positive());
        assert!(max(-0.0, 0.0).is_sign_positive());
        assert!(min(0.0, -0.0).is_sign_negative());
        assert!(min(-0.0, 0.0).is_sign_negative());
    }
}
