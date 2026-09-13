//! The paint-parity instrument's fixture shape: display commands as the
//! browser pen's JSON (`tools/paint-parity/fixtures`), written from the
//! engine's own painter output and parsed back for the lowering lane.
//! JSON exists only here; the production display list is typed end to
//! end.

mod color;
mod parse;
mod write;

pub(crate) use color::{color_css, css_color};
pub(crate) use parse::{parse_display_command, FixtureError};
pub(crate) use write::display_command_values;
