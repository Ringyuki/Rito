use crate::style::StyledNode;

use super::{AfterGroup, RubyState};

pub(super) fn drain_state_nodes(state: RubyState, output: &mut Vec<StyledNode>) {
    match state {
        RubyState::Planning(mut plan) => plan.drain_nodes_into(output),
        RubyState::Reserving(mut spec) => spec.drain_nodes_into(output),
        RubyState::Gathering(mut build) => build.drain_nodes_into(output),
        RubyState::AtBoundary(mut boundary) => boundary.drain_nodes_into(output),
        RubyState::Extracting(mut pending) => {
            output.append(&mut pending.nodes);
            pending.extraction.drain_nodes_into(output);
        }
        RubyState::ReadyGroup(mut group) => {
            output.append(&mut group.nodes);
            drain_after_nodes(group.after, output);
        }
        RubyState::WaitingGroup(waiting) => drain_after_nodes(waiting.after, output),
        RubyState::Applying(_, after) => drain_after_nodes(after, output),
        RubyState::Complete | RubyState::Transition => {}
    }
}

fn drain_after_nodes(after: AfterGroup, output: &mut Vec<StyledNode>) {
    if let AfterGroup::NextSeed(mut nodes) = after {
        output.append(&mut nodes);
    }
}
