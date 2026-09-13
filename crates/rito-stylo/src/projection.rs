mod inline;
mod layout;

pub(crate) use inline::project_inline;
pub use inline::{
    InlineStyleDisposition, InlineStyleField, InlineStyleProjection, InlineStyleProjectionReason,
};
pub(crate) use layout::project_layout;
pub use layout::{
    LayoutStyleDisposition, LayoutStyleField, LayoutStyleProjection, LayoutStyleProjectionReason,
};

/// The inline and layout style projections produced from one cascade.
#[derive(Debug)]
pub struct ProductionStyleProjection {
    inline: InlineStyleProjection,
    layout: LayoutStyleProjection,
}

impl ProductionStyleProjection {
    pub(crate) fn new(inline: InlineStyleProjection, layout: LayoutStyleProjection) -> Self {
        Self { inline, layout }
    }

    pub fn inline(&self) -> &InlineStyleProjection {
        &self.inline
    }

    pub fn layout(&self) -> &LayoutStyleProjection {
        &self.layout
    }

    pub fn into_parts(self) -> (InlineStyleProjection, LayoutStyleProjection) {
        (self.inline, self.layout)
    }
}
