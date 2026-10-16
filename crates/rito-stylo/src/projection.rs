mod generated;
mod inline;
mod layout;

use rito_style_contract::{GeneratedBoxTable, InlineStyleTable, LayoutStyleTable};

pub(crate) use generated::project_generated;
pub(crate) use inline::project_inline;
pub use inline::{
    InlineStyleDisposition, InlineStyleField, InlineStyleProjection, InlineStyleProjectionReason,
};
pub(crate) use layout::project_layout;
pub use layout::{
    LayoutStyleDisposition, LayoutStyleField, LayoutStyleProjection, LayoutStyleProjectionReason,
};

/// The inline and layout style projections produced from one cascade, and
/// the boxes it generated for `::before` and `::after`, whose styles are
/// interned in the same tables.
#[derive(Debug)]
pub struct ProductionStyleProjection {
    inline: InlineStyleProjection,
    layout: LayoutStyleProjection,
    generated: GeneratedBoxTable,
}

impl ProductionStyleProjection {
    pub(crate) fn new(
        inline: InlineStyleProjection,
        layout: LayoutStyleProjection,
        generated: GeneratedBoxTable,
    ) -> Self {
        Self {
            inline,
            layout,
            generated,
        }
    }

    pub fn generated(&self) -> &GeneratedBoxTable {
        &self.generated
    }

    /// The three tables a chapter keeps: inline styles, layout styles and
    /// generated boxes.
    pub fn into_tables(self) -> (InlineStyleTable, LayoutStyleTable, GeneratedBoxTable) {
        (
            self.inline.into_table(),
            self.layout.into_table(),
            self.generated,
        )
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
