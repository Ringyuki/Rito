//! The paper turn's behaviour as the web kit's tests told it while the turn
//! was TypeScript: one module for each of those test files, a module for
//! each of their `describe` blocks, and a test named for each sentence.

mod curl;
mod curl_held;
mod curl_hold;
mod curl_turn;
mod curled_page;
mod leaf;
mod leaves;
mod physics;

/// That `actual` is within half a unit in the `digits`-th decimal place of
/// `expected`: how near the web's tests held a number to another.
#[track_caller]
fn assert_close(actual: f64, expected: f64, digits: i32) {
    let within = libm::pow(10.0, -f64::from(digits)) / 2.0;
    assert!(
        actual == expected || (actual - expected).abs() < within,
        "{actual} is not within {within} of {expected}"
    );
}

/// That two numbers are the same number, 0 told from -0, as the web's tests compared them.
#[track_caller]
fn assert_is(actual: f64, expected: f64) {
    assert!(
        actual.to_bits() == expected.to_bits() || (actual.is_nan() && expected.is_nan()),
        "{actual:?} is not {expected:?}"
    );
}

/// How far apart two points in the air are.
fn apart(a: [f64; 3], b: [f64; 3]) -> f64 {
    let across = crate::math::hypot(a[0] - b[0], a[1] - b[1]);
    crate::math::hypot(across, a[2] - b[2])
}
