//! Reading a break token back. Strips one level off the resume path so
//! a child container re-enters exactly the descendant that was
//! interrupted, and finds the child index and consumed block size a
//! fragmentainer resumes from.

use crate::*;

/// Strips the leading path segment from a break token so a child container
/// resumes at exactly the interrupted descendant. A token whose path ends
/// at the container itself is only meaningful as `Before` (handled by the
/// caller as a fresh start); `Inside` cannot address a container directly.
pub(crate) fn descend_token(
    token: Option<&BreakToken>,
    consumed: f64,
) -> Result<Option<BreakToken>, LayoutError> {
    let Some(token) = token else {
        return Ok(None);
    };
    // Floats deeper than this level descend with the path, one level
    // stripped, so the container that split them consumes them at its own
    // depth 0.
    let descended_floats: Vec<FloatBreak> = token
        .pending_floats
        .iter()
        .filter(|entry| entry.depth > 0)
        .map(|entry| FloatBreak {
            child: entry.child,
            token: entry.token.clone(),
            depth: entry.depth - 1,
        })
        .collect();
    if token.resume_path.len() > 1 {
        return Ok(Some(BreakToken {
            resume_path: token.resume_path[1..].to_vec(),
            stage: token.stage,
            pending_floats: descended_floats,
        }));
    }
    if !descended_floats.is_empty() {
        // The named child finished its in-flow content on the previous
        // fragmentainer; only its split floats resume.
        return Ok(Some(BreakToken {
            resume_path: Vec::new(),
            stage: BreakTokenStage::Before,
            pending_floats: descended_floats,
        }));
    }
    if consumed != 0.0 {
        return Err(LayoutError::Invalid(
            "a break token cannot resume inside a block container without naming the \
             interrupted descendant"
                .to_owned(),
        ));
    }
    Ok(None)
}

pub(crate) fn resume_point(
    children: &[FormattingNodeId],
    token: Option<&BreakToken>,
) -> Result<(usize, f64, bool), LayoutError> {
    let Some(token) = token else {
        return Ok((0, 0.0, false));
    };
    let Some(target) = token.resume_path.first() else {
        if token.pending_floats.is_empty() {
            return Err(LayoutError::Invalid(
                "break token carries an empty resume path".to_owned(),
            ));
        }
        // Only split floats resume: every in-flow child already finished.
        return Ok((children.len(), 0.0, false));
    };
    let index = children
        .iter()
        .position(|child| child == target)
        .ok_or_else(|| {
            LayoutError::Invalid(format!("break token resumes at unknown child {}", target.0))
        })?;
    match token.stage {
        BreakTokenStage::Before => Ok((index, 0.0, false)),
        BreakTokenStage::Inside {
            consumed_block_size,
        } => Ok((index, consumed_block_size, true)),
    }
}
