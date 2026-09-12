mod chapter_local;

use crate::runtime::RuntimeRevisionWorkBudget;
fn budget(max_top_level_nodes: usize) -> RuntimeRevisionWorkBudget {
    RuntimeRevisionWorkBudget {
        max_top_level_nodes,
    }
}
