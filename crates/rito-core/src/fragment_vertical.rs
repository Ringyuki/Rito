//! The physical geometry shared by vertical paint and interaction artifacts.
use rito_fragment::{LineFragment, TextFragment};
use rito_style_contract::{InlineFormattingStyle, LengthPercentage};

#[derive(Clone, Copy)]
pub(crate) struct VerticalFrame {
    pub(crate) right: f64,
    pub(crate) top: f64,
}

impl VerticalFrame {
    pub(crate) fn rect(
        self,
        inline: f64,
        block: f64,
        width: f64,
        height: f64,
    ) -> (f64, f64, f64, f64) {
        (
            self.right - block - height,
            self.top + inline,
            height,
            width,
        )
    }

    pub(crate) fn column(self, line: &LineFragment, inline: f64, block: f64) -> VerticalColumn {
        VerticalColumn {
            x: self.right - (block + line.rect.y + line.rect.height),
            top: self.top + inline + line.rect.x,
            width: line.rect.height,
            ruby_growth: line.ruby_growth,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct VerticalColumn {
    pub(crate) x: f64,
    pub(crate) top: f64,
    width: f64,
    ruby_growth: f64,
}

pub(crate) struct VerticalRunGeometry {
    pub(crate) x: f64,
    pub(crate) top: f64,
    pub(crate) font_size: f64,
    pub(crate) step: f64,
}

impl VerticalColumn {
    pub(crate) fn run(
        self,
        run: &TextFragment,
        style: &InlineFormattingStyle,
    ) -> VerticalRunGeometry {
        let font_size = f64::from(style.font.size.get());
        // Match the painter's spacing: non-pixel spacing is painted as zero.
        let spacing = match style.text_flow.letter_spacing {
            LengthPercentage::Length(px) => f64::from(px.get()),
            _ => 0.0,
        } + run.justify_px;
        VerticalRunGeometry {
            x: self.x + (self.width - self.ruby_growth - font_size) / 2.0,
            top: self.top + run.rect.x,
            font_size,
            step: font_size + spacing,
        }
    }
}
