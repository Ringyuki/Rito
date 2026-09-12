mod inline_v1;
mod layout_v1;

pub(crate) use inline_v1::project_inline_v1;
pub use inline_v1::{
    InlineStyleDispositionV1, InlineStyleFieldV1, InlineStyleProjectionReasonV1,
    InlineStyleProjectionV1,
};
pub(crate) use layout_v1::project_layout_v1;
pub use layout_v1::{
    LayoutStyleDispositionV1, LayoutStyleFieldV1, LayoutStyleProjectionReasonV1,
    LayoutStyleProjectionV1,
};

/// The inline and layout style projections produced from one cascade.
#[derive(Debug)]
pub struct ProductionStyleProjectionV1 {
    inline: InlineStyleProjectionV1,
    layout: LayoutStyleProjectionV1,
}

impl ProductionStyleProjectionV1 {
    pub(crate) fn new(inline: InlineStyleProjectionV1, layout: LayoutStyleProjectionV1) -> Self {
        Self { inline, layout }
    }

    pub fn inline(&self) -> &InlineStyleProjectionV1 {
        &self.inline
    }

    pub fn layout(&self) -> &LayoutStyleProjectionV1 {
        &self.layout
    }

    pub fn into_parts(self) -> (InlineStyleProjectionV1, LayoutStyleProjectionV1) {
        (self.inline, self.layout)
    }
}
