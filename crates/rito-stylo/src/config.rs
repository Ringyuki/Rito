use std::sync::Once;

use style::thread_state::ThreadState;

static INITIALIZE_PREFS: Once = Once::new();

pub(crate) fn initialize_global_preferences() {
    INITIALIZE_PREFS.call_once(|| {
        // These preferences are process/module globals in Stylo. Rito fixes
        // them once and never mutates them per document.
        style_config::set_pref!("layout.threads", 0);
        style_config::set_pref!("layout.writing-mode.enabled", true);
        style_config::set_pref!("layout.columns.enabled", true);
        style_config::set_pref!("layout.grid.enabled", true);
        style_config::set_pref!("layout.variable_fonts.enabled", true);
        style_config::set_pref!("layout.css.font-variations.enabled", true);
        style_config::set_pref!("layout.css.basic-shape-shape.enabled", true);
        style_config::set_pref!("layout.css.properties-and-values.enabled", true);
        style_config::set_pref!("layout.container-queries.enabled", false);
        style_config::set_pref!("layout.unimplemented", false);
    });
}

pub(crate) struct LayoutThreadGuard;

impl LayoutThreadGuard {
    pub(crate) fn enter() -> Self {
        style::thread_state::enter(ThreadState::LAYOUT);
        Self
    }
}

impl Drop for LayoutThreadGuard {
    fn drop(&mut self) {
        style::thread_state::exit(ThreadState::LAYOUT);
    }
}
