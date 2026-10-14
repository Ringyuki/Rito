//! `rito-pack`: splits an EPUB into Rito publication shards.
//!
//! ```text
//! rito-pack <book.epub> <out-dir> [--encrypt]
//! ```
//!
//! Writes into `<out-dir>`:
//!
//! - `skeleton.rshd`: shard 0, which a reader opens the book from;
//! - `shards/<id>.rshd`: one file per content shard;
//! - `manifest.json`: the book id and, per shard, its file name, byte
//!   length and the publication files it carries (no keys);
//! - `keys.json` (with `--encrypt`): every shard's key as 64 hex digits.
//!
//! Keys and shards are written apart so they can be stored apart: shards
//! may sit on a CDN, keys belong behind the service that decides who may
//! read which shard.

use std::{
    fs,
    path::{Path, PathBuf},
    process,
};

use rito_core::epub::shard::{pack_publication, PackOptions, PackedPublication, PackedShard};
use serde_json::{json, Map, Value};

fn main() {
    if let Err(message) = run(std::env::args().skip(1).collect()) {
        eprintln!("rito-pack: {message}");
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let (input, output, encrypt) = parse_args(args)?;
    let epub = fs::read(&input).map_err(|error| format!("read {}: {error}", input.display()))?;
    let mut random = |buffer: &mut [u8]| {
        getrandom::fill(buffer).expect("the operating system random source is available");
    };
    let packed = pack_publication(&epub, PackOptions { encrypt }, &mut random)
        .map_err(|error| format!("pack {}: {}", input.display(), error.message()))?;
    write_output(&output, &packed)?;
    println!(
        "{}: {} content shards, skeleton {} bytes{}",
        output.display(),
        packed.shards.len(),
        packed.skeleton.bytes.len(),
        if encrypt { ", encrypted" } else { "" }
    );
    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<(PathBuf, PathBuf, bool), String> {
    let usage = "usage: rito-pack <book.epub> <out-dir> [--encrypt]";
    let mut encrypt = false;
    let mut positional = Vec::new();
    for arg in args {
        match arg.as_str() {
            "--encrypt" => encrypt = true,
            "-h" | "--help" => return Err(usage.to_owned()),
            flag if flag.starts_with("--") => return Err(format!("unknown flag {flag}\n{usage}")),
            _ => positional.push(PathBuf::from(arg)),
        }
    }
    let [input, output] = <[PathBuf; 2]>::try_from(positional).map_err(|_| usage.to_owned())?;
    Ok((input, output, encrypt))
}

fn write_output(output: &Path, packed: &PackedPublication) -> Result<(), String> {
    let shard_dir = output.join("shards");
    fs::create_dir_all(&shard_dir)
        .map_err(|error| format!("create {}: {error}", shard_dir.display()))?;
    write(&output.join("skeleton.rshd"), &packed.skeleton.bytes)?;
    for shard in &packed.shards {
        write(&shard_dir.join(shard_file_name(shard)), &shard.bytes)?;
    }
    let manifest = json!({
        "format": "rito-publication-shards",
        "formatVersion": rito_core::epub::shard::SHARD_FORMAT_VERSION,
        "bookId": hex(&packed.book_id),
        "encrypted": packed.skeleton.key.is_some(),
        "skeleton": shard_entry("skeleton.rshd", &packed.skeleton),
        "shards": packed
            .shards
            .iter()
            .map(|shard| shard_entry(&format!("shards/{}", shard_file_name(shard)), shard))
            .collect::<Vec<_>>(),
    });
    write_json(&output.join("manifest.json"), &manifest)?;
    if packed.skeleton.key.is_some() {
        let mut keys = Map::new();
        for shard in std::iter::once(&packed.skeleton).chain(&packed.shards) {
            let key = shard
                .key
                .as_ref()
                .expect("every shard of an encrypted pack has a key");
            keys.insert(
                shard.shard_id.to_string(),
                Value::String(hex(key.as_bytes())),
            );
        }
        let keys = json!({ "bookId": hex(&packed.book_id), "keys": keys });
        write_json(&output.join("keys.json"), &keys)?;
    }
    Ok(())
}

fn shard_file_name(shard: &PackedShard) -> String {
    format!("{}.rshd", shard.shard_id)
}

fn shard_entry(file: &str, shard: &PackedShard) -> Value {
    json!({
        "id": shard.shard_id,
        "file": file,
        "byteLength": shard.bytes.len(),
        "files": shard.files,
    })
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| format!("write {}: {error}", path.display()))
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(value).expect("JSON values serialize");
    text.push('\n');
    write(path, text.as_bytes())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
