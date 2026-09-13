//! Fixtures other in-crate tests build on: the plain block style they
//! intern for containers.

use rito_style_contract::LayoutFormattingStyle;

use super::styles::anonymous_block_style;

/// The style of a CSS anonymous block box: block-level flow with every
/// box property initial. Inherited properties live on the inline items
/// inside, so the layout slice is fully initial here.
/// The plain block style in-crate test fixtures intern for containers.
#[cfg(test)]
pub(crate) fn tests_block_style() -> LayoutFormattingStyle {
    anonymous_block_style()
}
