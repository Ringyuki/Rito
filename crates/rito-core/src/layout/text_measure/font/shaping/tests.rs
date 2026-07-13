use super::{measurement_advance, ShapeRunFailure};

#[test]
fn unsafe_retention_keeps_the_raw_rustybuzz_measurement_advance() {
    let raw_advance = 42.25;

    assert_eq!(
        measurement_advance(Err(ShapeRunFailure::NonGraphemeSafeClusters {
            advance: raw_advance,
        })),
        Some(raw_advance)
    );
}
