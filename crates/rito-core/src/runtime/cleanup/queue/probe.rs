use std::{cell::RefCell, rc::Rc};

#[derive(Debug)]
pub(super) struct RuntimeCleanupProbe {
    pub(super) id: usize,
    pub(super) remaining_units: usize,
    pub(super) log: Rc<RefCell<Vec<usize>>>,
}

impl RuntimeCleanupProbe {
    pub(super) fn is_complete(&self) -> bool {
        self.remaining_units == 0
    }

    pub(super) fn advance_one(&mut self) -> bool {
        if self.is_complete() {
            return false;
        }
        self.log.borrow_mut().push(self.id);
        self.remaining_units -= 1;
        true
    }
}
