//! The UAX #14 line breaking rules (Unicode 17, LB4–LB31) as ICU's rule
//! files state them, read in order at each boundary, with the tailorings
//! the rule sets add: `loose` breaks between inseparables, and
//! `loose_cj` breaks between an ideograph and a hyphen and narrows the
//! numeric prefixes and postfixes.

use super::classes::{Class, Props, RuleSet};
use Class::*;

/// The dotted circle, which stands for an aksara in LB28a.
const DOTTED_CIRCLE: char = '\u{25CC}';

/// For each character, whether a line may break before it (never before
/// the first).
pub(super) fn opportunities(chars: &[char], props: &[Props], rule_sets: &[RuleSet]) -> Vec<bool> {
    let text = Text::new(chars, props);
    let mut breaks = vec![false; chars.len()];
    for index in 1..chars.len() {
        breaks[index] = text.breaks_before(index, rule_sets[index], &breaks[..index]);
    }
    breaks
}

struct Text<'a> {
    chars: &'a [char],
    props: &'a [Props],
    /// Each character's own class.
    class: Vec<Class>,
    /// The character a combining mark takes its class from (LB9): the
    /// start of its combining sequence; a character's own index
    /// otherwise.
    base: Vec<usize>,
    /// The class each character's combining sequence reads as (LB9,
    /// LB10: a mark with nothing to combine with is a letter).
    unit: Vec<Class>,
    /// Whether the sequence ending here is a number followed by
    /// separators: NU (SY | IS)* (LB25).
    number: Vec<bool>,
    /// Regional indicators in a row ending here (LB30a).
    indicators: Vec<usize>,
}

impl<'a> Text<'a> {
    fn new(chars: &'a [char], props: &'a [Props]) -> Self {
        let class: Vec<Class> = props.iter().map(|props| props.class).collect();
        let mut base = Vec::with_capacity(chars.len());
        for index in 0..chars.len() {
            let attaches = index > 0
                && matches!(class[index], Cm | Zwj)
                && !matches!(class[base[index - 1]], Bk | Cr | Lf | Nl | Sp | Zw);
            base.push(if attaches { base[index - 1] } else { index });
        }
        let unit: Vec<Class> = base
            .iter()
            .map(|&start| match class[start] {
                Cm | Zwj => Al,
                other => other,
            })
            .collect();
        let mut number = vec![false; chars.len()];
        let mut indicators = vec![0; chars.len()];
        for index in 0..chars.len() {
            if base[index] != index {
                number[index] = number[base[index]];
                indicators[index] = indicators[base[index]];
                continue;
            }
            let previous = index.checked_sub(1);
            number[index] = match unit[index] {
                Nu => true,
                Sy | Is => previous.is_some_and(|previous| number[previous]),
                _ => false,
            };
            indicators[index] = if unit[index] == Ri {
                1 + previous.map_or(0, |previous| indicators[previous])
            } else {
                0
            };
        }
        Self {
            chars,
            props,
            class,
            base,
            unit,
            number,
            indicators,
        }
    }

    /// The unit before the one holding `index`.
    fn previous_unit(&self, index: usize) -> Option<usize> {
        self.base[index].checked_sub(1)
    }

    /// The unit after the one starting at `index`.
    fn next_unit(&self, index: usize) -> Option<usize> {
        (index + 1..self.chars.len()).find(|&next| self.base[next] == next)
    }

    /// The unit before the spaces that end at `index - 1`, if any.
    fn before_spaces(&self, index: usize) -> Option<usize> {
        let mut at = index - 1;
        while self.class[at] == Sp {
            at = at.checked_sub(1)?;
        }
        Some(at)
    }

    fn east_asian(&self, index: usize) -> bool {
        self.props[self.base[index]].east_asian
    }

    fn is_aksara(&self, index: usize) -> bool {
        matches!(self.unit[index], Ak | As) || self.chars[self.base[index]] == DOTTED_CIRCLE
    }

    /// Whether a line may break before `index`, given the verdicts before
    /// it (`earlier`).
    fn breaks_before(&self, index: usize, rule_set: RuleSet, earlier: &[bool]) -> bool {
        let before = self.class[index - 1];
        let after = self.class[index];
        // LB4, LB5: hard breaks.
        if before == Bk {
            return true;
        }
        if before == Cr && after == Lf {
            return false;
        }
        if matches!(before, Cr | Lf | Nl) {
            return true;
        }
        // LB6, LB7.
        if matches!(after, Bk | Cr | Lf | Nl | Sp | Zw) {
            return false;
        }
        // LB8: ZW SP* ÷
        if self
            .before_spaces(index)
            .is_some_and(|at| self.class[at] == Zw)
        {
            return true;
        }
        // LB8a, LB9.
        if before == Zwj || self.base[index] != index {
            return false;
        }
        let left = self.unit[index - 1];
        let right = self.unit[index];
        self.pairs(index, left, right, rule_set, earlier)
            .unwrap_or_else(|| self.numbers_and_letters(index, left, right, rule_set))
    }

    /// LB11–LB22: a verdict, or `None` to read on.
    fn pairs(
        &self,
        index: usize,
        left: Class,
        right: Class,
        rule_set: RuleSet,
        earlier: &[bool],
    ) -> Option<bool> {
        let left_start = self.base[index - 1];
        // LB11, LB12, LB12a, LB13.
        if right == Wj || left == Wj || left == Gl {
            return Some(false);
        }
        if right == Gl && !matches!(left, Sp | Ba | Hy | Hh) {
            return Some(false);
        }
        if matches!(right, Cl | Cp | Ex | Sy) {
            return Some(false);
        }
        let spaced = self.before_spaces(index).map(|at| self.unit[at]);
        // LB14: OP SP* ×
        if spaced == Some(Op) {
            return Some(false);
        }
        // LB15a: (sot | BK | CR | LF | NL | OP | QU | GL | SP | ZW) Pi SP* ×
        if let Some(at) = self.before_spaces(index) {
            if self.unit[at] == Qu && self.props[self.base[at]].initial_quote {
                let opens = self.previous_unit(at).is_none_or(|previous| {
                    matches!(
                        self.unit[previous],
                        Bk | Cr | Lf | Nl | Op | Qu | Gl | Sp | Zw
                    )
                });
                if opens {
                    return Some(false);
                }
            }
        }
        // LB15b: × Pf (SP | GL | WJ | CL | QU | CP | EX | IS | SY | BK | CR
        // | LF | NL | ZW | eot)
        if right == Qu && self.props[index].final_quote {
            let closes = self.next_unit(index).is_none_or(|next| {
                matches!(
                    self.unit[next],
                    Sp | Gl | Wj | Cl | Qu | Cp | Ex | Is | Sy | Bk | Cr | Lf | Nl | Zw
                )
            });
            if closes {
                return Some(false);
            }
        }
        // LB15c: SP ÷ IS NU; LB15d: × IS.
        if right == Is {
            let number_follows = self
                .next_unit(index)
                .is_some_and(|next| self.unit[next] == Nu);
            return Some(left == Sp && number_follows);
        }
        // LB16: (CL | CP) SP* × NS; LB17: B2 SP* × B2.
        if right == Ns && matches!(spaced, Some(Cl | Cp)) {
            return Some(false);
        }
        if right == B2 && spaced == Some(B2) {
            return Some(false);
        }
        // LB18.
        if left == Sp {
            return Some(true);
        }
        // LB19: × [QU - Pi]; [QU - Pf] ×
        if right == Qu && !self.props[index].initial_quote {
            return Some(false);
        }
        if left == Qu && !self.props[left_start].final_quote {
            return Some(false);
        }
        // LB19a: a quotation mark not between East Asian characters.
        if right == Qu {
            let east_asian_after = self
                .next_unit(index)
                .is_some_and(|next| self.east_asian(next));
            if !self.east_asian(index - 1) || !east_asian_after {
                return Some(false);
            }
        }
        if left == Qu {
            let east_asian_before = self
                .previous_unit(index - 1)
                .is_some_and(|previous| self.east_asian(previous));
            if !self.props[index].east_asian || !east_asian_before {
                return Some(false);
            }
        }
        // LB20.
        if right == Cb || left == Cb {
            return Some(true);
        }
        // LB20a: a hyphen that starts a word stays with it. ICU reads a
        // word start as any break opportunity before the hyphen (its
        // `^(HY | HH) × (AL | HL)`), or a space, a glue or a contingent
        // break before it.
        if matches!(left, Hy | Hh) && matches!(right, Al | Hl) {
            let starts_word = earlier[left_start]
                || self
                    .previous_unit(index - 1)
                    .is_none_or(|previous| matches!(self.unit[previous], Sp | Gl | Cb));
            if starts_word {
                return Some(false);
            }
        }
        // LB21: × (BA | HH | HY | NS); BB ×. `loose_cj` breaks ID ÷ HH.
        if matches!(right, Ba | Hh | Hy | Ns) && !(rule_set.loose_cj() && left == Id && right == Hh)
        {
            return Some(false);
        }
        if left == Bb {
            return Some(false);
        }
        // LB21a: HL (HY | HH) × [^HL]; LB21b: SY × HL.
        if matches!(left, Hy | Hh)
            && right != Hl
            && self
                .previous_unit(index - 1)
                .is_some_and(|previous| self.unit[previous] == Hl)
        {
            return Some(false);
        }
        if left == Sy && right == Hl {
            return Some(false);
        }
        // LB22: × IN. `loose` breaks between inseparables.
        if right == In && !(rule_set.loose() && left == In) {
            return Some(false);
        }
        None
    }

    /// LB23–LB31.
    fn numbers_and_letters(
        &self,
        index: usize,
        left: Class,
        right: Class,
        rule_set: RuleSet,
    ) -> bool {
        let left_start = self.base[index - 1];
        let alphabetic = |class: Class| matches!(class, Al | Hl);
        // LB23.
        if (alphabetic(left) && right == Nu) || (left == Nu && alphabetic(right)) {
            return false;
        }
        // LB23a.
        if (left == Pr && matches!(right, Id | Eb | Em))
            || (matches!(left, Id | Eb | Em) && right == Po)
        {
            return false;
        }
        // LB24 (`loose_cj` keeps its postfix exceptions here).
        let affix = |class: Class| matches!(class, Pr | Po | PoX);
        if (affix(left) && alphabetic(right)) || (alphabetic(left) && affix(right)) {
            return false;
        }
        if !self.within_number(index, left, right, rule_set) {
            return false;
        }
        // LB26, LB27: Korean syllables.
        let hangul = |class: Class| matches!(class, Jl | Jv | Jt | H2 | H3);
        if (left == Jl && matches!(right, Jl | Jv | H2 | H3))
            || (matches!(left, Jv | H2) && matches!(right, Jv | Jt))
            || (matches!(left, Jt | H3) && right == Jt)
            || (hangul(left) && right == Po)
            || (left == Pr && hangul(right))
        {
            return false;
        }
        // LB28.
        if alphabetic(left) && alphabetic(right) {
            return false;
        }
        // LB28a: orthographic syllables.
        if (left == Ap && self.is_aksara(index))
            || (self.is_aksara(index - 1) && matches!(right, Vf | Vi))
            || (left == Vi
                && (right == Ak || self.chars[index] == DOTTED_CIRCLE)
                && self
                    .previous_unit(index - 1)
                    .is_some_and(|previous| self.is_aksara(previous)))
            || (self.is_aksara(index - 1)
                && self.is_aksara(index)
                && self
                    .next_unit(index)
                    .is_some_and(|next| self.unit[next] == Vf))
        {
            return false;
        }
        // LB29, LB30.
        if left == Is && alphabetic(right) {
            return false;
        }
        if matches!(left, Al | Hl | Nu) && right == Op && !self.props[index].east_asian {
            return false;
        }
        if left == Cp && !self.props[left_start].east_asian && matches!(right, Al | Hl | Nu) {
            return false;
        }
        // LB30a: regional indicators pair.
        if left == Ri && right == Ri && self.indicators[index - 1] % 2 == 1 {
            return false;
        }
        // LB30b.
        if right == Em && (left == Eb || self.props[left_start].unassigned_pictograph) {
            return false;
        }
        // LB31.
        true
    }

    /// LB25: whether the boundary may break as far as numbers go
    /// (`(PR | PO)? (OP | HY)? IS? NU (NU | SY | IS)* (CL | CP)?
    /// (PR | PO)?` stays together; `loose_cj` opens with its postfix
    /// exceptions and closes with its prefix exceptions too).
    fn within_number(&self, index: usize, left: Class, right: Class, rule_set: RuleSet) -> bool {
        let suffix =
            |class: Class| matches!(class, Pr | Po) || (rule_set.loose_cj() && class == PrX);
        let prefix = |class: Class| matches!(class, Pr | Po | PoX);
        let after_number = self.number[index - 1];
        if after_number && (right == Nu || suffix(right)) {
            return false;
        }
        if matches!(left, Cl | Cp)
            && suffix(right)
            && self
                .previous_unit(index - 1)
                .is_some_and(|previous| self.number[previous])
        {
            return false;
        }
        if prefix(left) {
            if right == Nu {
                return false;
            }
            if right == Op {
                let next = self.next_unit(index);
                let next_is = |class: Class| next.is_some_and(|next| self.unit[next] == class);
                let after_separator = next
                    .filter(|&next| self.unit[next] == Is)
                    .and_then(|next| self.next_unit(next))
                    .is_some_and(|next| self.unit[next] == Nu);
                if next_is(Nu) || after_separator {
                    return false;
                }
            }
        }
        if matches!(left, Hy | Is) && right == Nu {
            return false;
        }
        true
    }
}
