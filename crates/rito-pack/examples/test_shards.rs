//! Packs an EPUB into encrypted shards for the Flutter tests, whose release
//! lane builds no JavaScript and so cannot run `@ritojs/pack`.
//!
//! ```text
//! cargo run -p rito-pack --example test_shards -- <book.epub> <out-dir>
//! ```
//!
//! Writes `<id>.rshd` and `<id>.key` for every shard, the skeleton being
//! shard 0. The keys come from a fixed sequence, not a random source: what
//! this packs is for tests, never for a publication.

use std::{fs, path::Path, process};

use rito_core::epub::shard::{pack_publication, PackOptions, PackedShard};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: test_shards <book.epub> <out-dir>");
        process::exit(2);
    };
    if let Err(message) = run(Path::new(input), Path::new(output)) {
        eprintln!("test_shards: {message}");
        process::exit(1);
    }
}

fn run(input: &Path, output: &Path) -> Result<(), String> {
    let epub = fs::read(input).map_err(|error| format!("read {}: {error}", input.display()))?;
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut fill = |buffer: &mut [u8]| {
        for byte in buffer {
            // xorshift64
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *byte = state.to_le_bytes()[0];
        }
    };
    let packed = pack_publication(&epub, PackOptions { encrypt: true }, &mut fill)
        .map_err(|error| format!("pack {}: {}", input.display(), error.message()))?;
    fs::create_dir_all(output).map_err(|error| format!("create {}: {error}", output.display()))?;
    for shard in std::iter::once(&packed.skeleton).chain(&packed.shards) {
        write_shard(output, shard)?;
    }
    Ok(())
}

fn write_shard(output: &Path, shard: &PackedShard) -> Result<(), String> {
    let key = shard
        .key
        .as_ref()
        .expect("every shard of an encrypted pack has a key");
    write(
        &output.join(format!("{}.rshd", shard.shard_id)),
        &shard.bytes,
    )?;
    write(
        &output.join(format!("{}.key", shard.shard_id)),
        key.as_bytes(),
    )
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| format!("write {}: {error}", path.display()))
}
