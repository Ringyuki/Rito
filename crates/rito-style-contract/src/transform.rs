use std::{fmt, sync::Arc};

use crate::{FiniteF32, INLINE_STYLE_LIST_ITEM_LIMIT};

/// One exactly represented operation in the computed `transform` list.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TransformOperation {
    /// A two-dimensional rotation around the element's default center origin.
    Rotate {
        /// Clockwise angle in radians.
        radians: FiniteF32,
    },
}

/// Error returned when a computed transform list violates the V1 resource cap.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransformListError {
    /// The ordered operation list exceeded the shared inline-style item limit.
    ItemLimitExceeded {
        /// Actual operation count.
        item_count: usize,
        /// Maximum accepted operation count.
        limit: usize,
    },
}

impl fmt::Display for TransformListError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ItemLimitExceeded { item_count, limit } => {
                write!(
                    formatter,
                    "transform has {item_count} operations; limit is {limit}"
                )
            }
        }
    }
}

impl std::error::Error for TransformListError {}

/// A bounded, ordered computed transform list; an empty list represents `none`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TransformList(Arc<[TransformOperation]>);

impl TransformList {
    /// Validates and owns an ordered computed transform list.
    pub fn new(operations: Vec<TransformOperation>) -> Result<Self, TransformListError> {
        if operations.len() > INLINE_STYLE_LIST_ITEM_LIMIT {
            return Err(TransformListError::ItemLimitExceeded {
                item_count: operations.len(),
                limit: INLINE_STYLE_LIST_ITEM_LIMIT,
            });
        }
        Ok(Self(Arc::from(operations)))
    }

    /// Returns the canonical empty list used for computed `none`.
    pub fn none() -> Self {
        Self(Arc::from(Vec::new()))
    }

    /// Returns operations in CSS application order.
    pub fn as_slice(&self) -> &[TransformOperation] {
        &self.0
    }

    /// Reports whether this list represents computed `none`.
    pub fn is_none(&self) -> bool {
        self.0.is_empty()
    }

    pub(crate) fn storage_identity(&self) -> usize {
        self.0.as_ptr() as usize
    }
}

impl Default for TransformList {
    fn default() -> Self {
        Self::none()
    }
}

#[cfg(test)]
mod tests {
    use super::{TransformList, TransformListError, TransformOperation};
    use crate::{FiniteF32, INLINE_STYLE_LIST_ITEM_LIMIT};

    #[test]
    fn empty_transform_list_canonically_represents_none() {
        let value = TransformList::new(Vec::new()).unwrap();
        assert!(value.is_none());
        assert!(value.as_slice().is_empty());
    }

    #[test]
    fn transform_list_is_bounded() {
        let rotate = TransformOperation::Rotate {
            radians: FiniteF32::new(0.0).unwrap(),
        };
        let operations = vec![rotate; INLINE_STYLE_LIST_ITEM_LIMIT + 1];
        assert_eq!(
            TransformList::new(operations),
            Err(TransformListError::ItemLimitExceeded {
                item_count: INLINE_STYLE_LIST_ITEM_LIMIT + 1,
                limit: INLINE_STYLE_LIST_ITEM_LIMIT,
            })
        );
    }
}
