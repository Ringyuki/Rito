use std::{fmt, sync::Arc};

use crate::{FiniteF32, INLINE_STYLE_LIST_ITEM_LIMIT_V1};

/// One exactly represented operation in the computed `transform` list.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum TransformOperationV1 {
    /// A two-dimensional rotation around the element's default center origin.
    Rotate {
        /// Clockwise angle in radians.
        radians: FiniteF32,
    },
}

/// Error returned when a computed transform list violates the V1 resource cap.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransformListErrorV1 {
    /// The ordered operation list exceeded the shared inline-style item limit.
    ItemLimitExceeded {
        /// Actual operation count.
        item_count: usize,
        /// Maximum accepted operation count.
        limit: usize,
    },
}

impl fmt::Display for TransformListErrorV1 {
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

impl std::error::Error for TransformListErrorV1 {}

/// A bounded, ordered computed transform list; an empty list represents `none`.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TransformListV1(Arc<[TransformOperationV1]>);

impl TransformListV1 {
    /// Validates and owns an ordered computed transform list.
    pub fn new(operations: Vec<TransformOperationV1>) -> Result<Self, TransformListErrorV1> {
        if operations.len() > INLINE_STYLE_LIST_ITEM_LIMIT_V1 {
            return Err(TransformListErrorV1::ItemLimitExceeded {
                item_count: operations.len(),
                limit: INLINE_STYLE_LIST_ITEM_LIMIT_V1,
            });
        }
        Ok(Self(Arc::from(operations)))
    }

    /// Returns the canonical empty list used for computed `none`.
    pub fn none() -> Self {
        Self(Arc::from(Vec::new()))
    }

    /// Returns operations in CSS application order.
    pub fn as_slice(&self) -> &[TransformOperationV1] {
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

impl Default for TransformListV1 {
    fn default() -> Self {
        Self::none()
    }
}

#[cfg(test)]
mod tests {
    use super::{TransformListErrorV1, TransformListV1, TransformOperationV1};
    use crate::{FiniteF32, INLINE_STYLE_LIST_ITEM_LIMIT_V1};

    #[test]
    fn empty_transform_list_canonically_represents_none() {
        let value = TransformListV1::new(Vec::new()).unwrap();
        assert!(value.is_none());
        assert!(value.as_slice().is_empty());
    }

    #[test]
    fn transform_list_is_bounded() {
        let rotate = TransformOperationV1::Rotate {
            radians: FiniteF32::new(0.0).unwrap(),
        };
        let operations = vec![rotate; INLINE_STYLE_LIST_ITEM_LIMIT_V1 + 1];
        assert_eq!(
            TransformListV1::new(operations),
            Err(TransformListErrorV1::ItemLimitExceeded {
                item_count: INLINE_STYLE_LIST_ITEM_LIMIT_V1 + 1,
                limit: INLINE_STYLE_LIST_ITEM_LIMIT_V1,
            })
        );
    }
}
