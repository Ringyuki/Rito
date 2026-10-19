//! Forensic output a native probe switches on in the environment (wasm has
//! no environment, so it never prints there). Each switch is read once per
//! process: the line loop consults them for every line it builds.

use std::sync::OnceLock;

/// `RITO_LINE_DEBUG`: every line's runs and the rules that placed them.
pub(crate) fn line_debug() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    switched_on(&FLAG, "RITO_LINE_DEBUG")
}

/// `RITO_BRK_DEBUG`: the line-end kerning a break left in the slack.
pub(crate) fn break_debug() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    switched_on(&FLAG, "RITO_BRK_DEBUG")
}

/// `RITO_JUST_DEBUG`: each justified line's plan and shares.
pub(crate) fn justify_debug() -> bool {
    static FLAG: OnceLock<bool> = OnceLock::new();
    switched_on(&FLAG, "RITO_JUST_DEBUG")
}

fn switched_on(flag: &OnceLock<bool>, name: &str) -> bool {
    *flag.get_or_init(|| std::env::var_os(name).is_some())
}
