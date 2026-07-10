//! Production Rust engine for Rito.
//!
//! This crate owns EPUB parsing, style resolution, layout, display commands,
//! interaction geometry, resources, and the revision/frame runtime. The
//! quarantined TypeScript core remains a parity and diagnostics oracle only.

pub mod css;
pub mod epub;
pub mod interaction;
pub mod layout;
pub mod render;
pub mod resources;
pub mod runtime;
pub mod style;
pub mod xhtml;

pub const ENGINE_NAME: &str = "rito-core";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineModule {
    pub name: &'static str,
    pub owns: &'static str,
}

pub const ENGINE_MODULES: &[EngineModule] = &[
    EngineModule {
        name: epub::NAME,
        owns: epub::OWNS,
    },
    EngineModule {
        name: xhtml::NAME,
        owns: xhtml::OWNS,
    },
    EngineModule {
        name: css::NAME,
        owns: css::OWNS,
    },
    EngineModule {
        name: style::NAME,
        owns: style::OWNS,
    },
    EngineModule {
        name: layout::NAME,
        owns: layout::OWNS,
    },
    EngineModule {
        name: render::NAME,
        owns: render::OWNS,
    },
    EngineModule {
        name: interaction::NAME,
        owns: interaction::OWNS,
    },
    EngineModule {
        name: resources::NAME,
        owns: resources::OWNS,
    },
    EngineModule {
        name: runtime::NAME,
        owns: runtime::OWNS,
    },
];

pub fn engine_modules() -> &'static [EngineModule] {
    ENGINE_MODULES
}

#[cfg(test)]
mod tests {
    use super::{engine_modules, ENGINE_NAME};

    #[test]
    fn exposes_engine_identity() {
        assert_eq!(ENGINE_NAME, "rito-core");
        assert_eq!(engine_modules().len(), 9);
    }
}
