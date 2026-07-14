use super::{AfterGroup, RubyState};
use crate::layout::inline_content::pending::cleanup::drop_styled_node_forest_iteratively;

pub(super) fn drop_state_nodes(state: RubyState) {
    match state {
        RubyState::Planning(mut plan) => plan.drop_owned_nodes(),
        RubyState::Reserving(mut spec) => spec.drop_owned_nodes(),
        RubyState::Gathering(mut build) => build.drop_owned_nodes(),
        RubyState::AtBoundary(mut boundary) => boundary.drop_owned_nodes(),
        RubyState::Extracting(mut pending) => {
            drop_styled_node_forest_iteratively(std::mem::take(&mut pending.nodes));
            drop(pending.extraction);
        }
        RubyState::ReadyGroup(mut group) => {
            drop_styled_node_forest_iteratively(std::mem::take(&mut group.nodes));
            drop_after_nodes(group.after);
        }
        RubyState::WaitingGroup(waiting) => drop_after_nodes(waiting.after),
        RubyState::Applying(_, after) => drop_after_nodes(after),
        RubyState::Complete | RubyState::Transition => {}
    }
}

fn drop_after_nodes(after: AfterGroup) {
    if let AfterGroup::NextSeed(nodes) = after {
        drop_styled_node_forest_iteratively(nodes);
    }
}
