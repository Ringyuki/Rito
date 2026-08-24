#![allow(unsafe_code)]

use style::{
    animation::{Animation, AnimationState, DocumentAnimationSet, KeyframesIterationState},
    context::{
        RegisteredSpeculativePainter, RegisteredSpeculativePainters, SharedStyleContext,
        StyleContext,
    },
    dom::{TElement, TNode},
    global_style_data::GLOBAL_STYLE_DATA,
    invalidation::element::restyle_hints::RestyleHint,
    selector_parser::SnapshotMap,
    shared_lock::StylesheetGuards,
    stylist::Stylist,
    traversal::{DomTraversal, PerLevelTraversalData},
    traversal_flags::TraversalFlags,
    values::computed::AnimationDirection,
    Atom,
};

use crate::{config::LayoutThreadGuard, dom::DomStorage};

pub(crate) fn resolve(
    dom: &DomStorage,
    stylist: &mut Stylist,
    animations: &DocumentAnimationSet,
    snapshots: &mut SnapshotMap,
    now: f64,
) {
    let _thread = LayoutThreadGuard::enter();
    let guard = dom.shared_lock().read();
    let guards = StylesheetGuards::same(&guard);
    let root = dom.root_element();
    stylist.flush(&guards).process_style(root, Some(snapshots));
    tick_animations(dom, animations, now);

    let context = SharedStyleContext {
        stylist,
        visited_styles_enabled: false,
        options: GLOBAL_STYLE_DATA.options.clone(),
        guards,
        current_time_for_animations: now,
        traversal_flags: TraversalFlags::empty(),
        snapshot_map: snapshots,
        animations: animations.clone(),
        registered_speculative_painters: &REGISTERED_PAINTERS,
    };
    let token = RecalcStyle::pre_traverse(root, &context);
    if token.should_traverse() {
        let traverser = RecalcStyle::new(context);
        style::driver::traverse_dom(&traverser, token, None);
    }

    snapshots.clear();
    finish_animation_tick(animations);
    stylist.rule_tree().maybe_gc();
}

fn tick_animations(dom: &DomStorage, animations: &DocumentAnimationSet, now: f64) {
    let mut sets = animations.sets.write();
    for (key, set) in sets.iter_mut() {
        let Some(node_id) = dom.node_id_from_opaque(key.node.id()) else {
            set.animations.clear();
            set.transitions.clear();
            continue;
        };
        dom.mark_restyle(node_id, RestyleHint::RESTYLE_SELF);

        for animation in &mut set.animations {
            if animation.state == AnimationState::Pending && animation.started_at <= now {
                animation.state = AnimationState::Running;
            }
            advance_animation_iterations(animation, now);
            if animation.state == AnimationState::Running && animation.has_ended(now) {
                animation.state = AnimationState::Finished;
            }
        }
        for transition in &mut set.transitions {
            if transition.state == AnimationState::Pending && transition.start_time <= now {
                transition.state = AnimationState::Running;
            }
            if transition.state == AnimationState::Running && transition.has_ended(now) {
                transition.state = AnimationState::Finished;
            }
        }
    }
}

fn advance_animation_iterations(animation: &mut Animation, now: f64) {
    if animation.state != AnimationState::Running
        || animation.duration <= 0.0
        || now <= animation.started_at + animation.duration
    {
        return;
    }

    // Stylo 0.19's public `iterate_if_necessary` advances at most one
    // iteration. A reader can legitimately miss several animation frames, so
    // advance the same public state in O(1) instead of looping once per missed
    // iteration. This mirrors Stylo's private `iterate_by` cap: the final full
    // or fractional iteration is retained for progress calculation.
    let elapsed_iterations = (now - animation.started_at) / animation.duration;
    let requested = (elapsed_iterations.ceil() - 1.0).max(0.0);
    let remaining = match animation.iteration_state {
        KeyframesIterationState::Finite(current, maximum) => maximum - current,
        KeyframesIterationState::Infinite(_) => f64::INFINITY,
    };
    let iterations = requested.min(remaining.ceil() - 1.0).trunc();
    if iterations < 1.0 {
        return;
    }

    match animation.iteration_state {
        KeyframesIterationState::Finite(ref mut current, maximum) => {
            *current = (*current + iterations).min(maximum);
        }
        KeyframesIterationState::Infinite(ref mut current) => *current += iterations,
    }
    animation.started_at += animation.duration * iterations;

    if matches!(
        animation.direction,
        AnimationDirection::Alternate | AnimationDirection::AlternateReverse
    ) && iterations % 2.0 == 1.0
    {
        animation.current_direction = match animation.current_direction {
            AnimationDirection::Normal => AnimationDirection::Reverse,
            AnimationDirection::Reverse => AnimationDirection::Normal,
            _ => unreachable!("current animation direction must be normal or reverse"),
        };
    }
}

fn finish_animation_tick(animations: &DocumentAnimationSet) {
    let mut sets = animations.sets.write();
    for set in sets.values_mut() {
        set.clear_canceled_animations();
        for animation in &mut set.animations {
            animation.is_new = false;
        }
        for transition in &mut set.transitions {
            transition.is_new = false;
        }
    }
    sets.retain(|_, set| !set.is_empty());
}

struct RegisteredPainters;

static REGISTERED_PAINTERS: RegisteredPainters = RegisteredPainters;

impl RegisteredSpeculativePainters for RegisteredPainters {
    fn get(&self, _name: &Atom) -> Option<&dyn RegisteredSpeculativePainter> {
        None
    }
}

struct RecalcStyle<'a> {
    context: SharedStyleContext<'a>,
}

impl<'a> RecalcStyle<'a> {
    fn new(context: SharedStyleContext<'a>) -> Self {
        Self { context }
    }
}

impl<E> DomTraversal<E> for RecalcStyle<'_>
where
    E: TElement,
{
    fn process_preorder<F>(
        &self,
        traversal_data: &PerLevelTraversalData,
        context: &mut StyleContext<E>,
        node: E::ConcreteNode,
        note_child: F,
    ) where
        F: FnMut(E::ConcreteNode),
    {
        if let Some(element) = node.as_element() {
            // SAFETY: StyleDocument is !Send/!Sync and this adapter always
            // passes `None` as Stylo's Rayon pool, so this traversal owns the
            // sole mutable access to every element sidecar.
            let mut data = unsafe { element.ensure_data() };
            style::traversal::recalc_style_at(
                self,
                traversal_data,
                context,
                element,
                &mut data,
                note_child,
            );
            // SAFETY: same exclusive sequential traversal invariant.
            unsafe { element.unset_dirty_descendants() };
        }
    }

    fn needs_postorder_traversal() -> bool {
        false
    }

    fn process_postorder(&self, _context: &mut StyleContext<E>, _node: E::ConcreteNode) {
        unreachable!("Rito's style-only traversal has no postorder phase")
    }

    fn shared_context(&self) -> &SharedStyleContext<'_> {
        &self.context
    }
}
