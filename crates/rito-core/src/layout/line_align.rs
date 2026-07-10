use serde_json::{Map, Value};

use super::{
    line::{LineBox, LineRun},
    line_break::contains_cjk,
    line_ruby::extract_ruby_annotations,
    style_values::string_style,
};

pub(crate) fn apply_line_align(
    mut runs: Vec<LineRun>,
    line_width: f64,
    y: f64,
    height: f64,
    max_width: f64,
    base_style: &Map<String, Value>,
    is_last_line: bool,
) -> LineBox {
    let align = string_style(base_style, "textAlign").unwrap_or_else(|| "left".to_owned());
    let offset = match align.as_str() {
        "center" if !runs.is_empty() => (max_width - line_width) / 2.0,
        "right" if !runs.is_empty() => max_width - line_width,
        _ => 0.0,
    };
    if align == "justify" && !is_last_line && !runs.is_empty() {
        runs = justify_runs(runs, line_width, max_width, base_style);
    }
    let runs = offset_runs_x(runs, offset);
    LineBox {
        x: 0.0,
        y,
        width: max_width,
        height,
        runs: extract_ruby_annotations(runs, y),
    }
}

fn justify_runs(
    runs: Vec<LineRun>,
    line_width: f64,
    max_width: f64,
    base_style: &Map<String, Value>,
) -> Vec<LineRun> {
    let extra = max_width - line_width;
    let text_justify = string_style(base_style, "textJustify").unwrap_or_else(|| "auto".to_owned());
    if extra <= 0.0 || text_justify == "none" {
        return runs;
    }

    let space_gaps = runs.iter().map(count_run_spaces).sum::<usize>();
    if space_gaps > 0 && text_justify != "inter-character" {
        return distribute_space_gaps(runs, extra / space_gaps as f64);
    }

    if text_justify == "inter-word" {
        return runs;
    }

    let Some(plan) = collect_inter_character_gaps(&runs) else {
        return runs;
    };
    if plan.total_gaps == 0 {
        return runs;
    }
    let gap_size = extra / plan.total_gaps as f64;
    distribute_inter_character_gaps(runs, plan, gap_size)
}

fn count_run_spaces(run: &LineRun) -> usize {
    match run {
        LineRun::Text(run) => run
            .text
            .chars()
            .filter(|character| *character == ' ')
            .count(),
        LineRun::Atom(_) | LineRun::Ruby(_) => 0,
    }
}

fn distribute_space_gaps(runs: Vec<LineRun>, gap_size: f64) -> Vec<LineRun> {
    let mut result = Vec::with_capacity(runs.len());
    let mut x_offset = 0.0;

    for run in runs {
        match run {
            LineRun::Text(mut run) => {
                let intra_gaps = run
                    .text
                    .chars()
                    .filter(|character| *character == ' ')
                    .count();
                run.x += x_offset;
                run.width += intra_gaps as f64 * gap_size;
                run.add_paint_spacing("wordSpacingPx", gap_size);
                x_offset += intra_gaps as f64 * gap_size;
                result.push(LineRun::Text(run));
            }
            LineRun::Atom(mut run) => {
                run.x += x_offset;
                result.push(LineRun::Atom(run));
            }
            LineRun::Ruby(mut run) => {
                run.x += x_offset;
                result.push(LineRun::Ruby(run));
            }
        }
    }

    result
}

struct InterCharacterGapPlan {
    per_run: Vec<usize>,
    boundary_before: Vec<bool>,
    total_gaps: usize,
}

fn collect_inter_character_gaps(runs: &[LineRun]) -> Option<InterCharacterGapPlan> {
    if runs.iter().any(|run| matches!(run, LineRun::Atom(_))) {
        return None;
    }

    let mut per_run = vec![0; runs.len()];
    let mut boundary_before = vec![false; runs.len()];
    let mut total_gaps = 0usize;
    let mut previous_text_was_east_asian = false;

    for (index, run) in runs.iter().enumerate() {
        let LineRun::Text(run) = run else {
            previous_text_was_east_asian = false;
            continue;
        };
        let has_east_asian = contains_cjk(&run.text);
        let intra_gaps = if has_east_asian {
            run.text.chars().count().saturating_sub(1)
        } else {
            0
        };
        per_run[index] = intra_gaps;
        total_gaps += intra_gaps;
        if previous_text_was_east_asian && has_east_asian {
            boundary_before[index] = true;
            total_gaps += 1;
        }
        previous_text_was_east_asian = has_east_asian;
    }

    (total_gaps > 0).then_some(InterCharacterGapPlan {
        per_run,
        boundary_before,
        total_gaps,
    })
}

fn distribute_inter_character_gaps(
    runs: Vec<LineRun>,
    plan: InterCharacterGapPlan,
    gap_size: f64,
) -> Vec<LineRun> {
    let mut result = Vec::with_capacity(runs.len());
    let mut x_offset = 0.0;

    for (index, run) in runs.into_iter().enumerate() {
        if plan.boundary_before.get(index).copied().unwrap_or(false) {
            x_offset += gap_size;
        }
        match run {
            LineRun::Text(mut run) => {
                let intra_gaps = plan.per_run.get(index).copied().unwrap_or(0);
                run.x += x_offset;
                run.width += intra_gaps as f64 * gap_size;
                if intra_gaps > 0 {
                    run.add_paint_spacing("letterSpacingPx", gap_size);
                }
                x_offset += intra_gaps as f64 * gap_size;
                result.push(LineRun::Text(run));
            }
            LineRun::Atom(mut run) => {
                run.x += x_offset;
                result.push(LineRun::Atom(run));
            }
            LineRun::Ruby(mut run) => {
                run.x += x_offset;
                result.push(LineRun::Ruby(run));
            }
        }
    }

    result
}

fn offset_runs_x(runs: Vec<LineRun>, dx: f64) -> Vec<LineRun> {
    if dx == 0.0 {
        return runs;
    }
    runs.into_iter()
        .map(|mut run| {
            run.shift_x(dx);
            run
        })
        .collect()
}
