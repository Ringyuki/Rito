use std::{env, fs, path::Path};

use rito_core::{bench::capture_bounded_pagination_work, epub::load_publication};
use serde_json::{json, Value};

fn main() -> Result<(), String> {
    let paths = env::args_os().skip(1).collect::<Vec<_>>();
    if paths.is_empty() {
        return Err("usage: stylo-production-probe <book.epub> [more-books.epub ...]".to_owned());
    }

    let mut failed = false;
    for path in paths {
        let path = Path::new(&path);
        match probe(path) {
            Ok(report) => println!("{report}"),
            Err(error) => {
                failed = true;
                eprintln!("{}: {error}", path.display());
            }
        }
    }

    (!failed)
        .then_some(())
        .ok_or_else(|| "one or more EPUB probes failed".to_owned())
}

fn probe(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| format!("read failed: {error}"))?;
    let (publication, probe) = capture_bounded_pagination_work(|| load_publication(&bytes));
    let publication = publication.map_err(|error| format!("load/layout failed: {error}"))?;

    Ok(json!({
        "path": path,
        "elapsedNs": probe.capture_wall_time_ns,
        "elapsedMs": probe.capture_wall_time_ns as f64 / 1_000_000.0,
        "chapterCount": publication.chapters.len(),
        "pageCount": publication.layout.pagination_flow.page_count,
        "styleBackendDelta": probe.style_backend,
    }))
}
