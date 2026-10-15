//! WASM-facing boundary for the server side of Rito: packing an EPUB into
//! publication shards, and checking that the reader can read an EPUB.
//! `@ritojs/pack` runs it in a worker thread per call.

use rito_core::epub::{self, shard};
use wasm_bindgen::prelude::*;

/// A packed publication. Shard `0` is the skeleton; the content shards
/// follow by ascending id.
#[wasm_bindgen]
pub struct PackedPublication {
    book_id: [u8; 16],
    shards: Vec<shard::PackedShard>,
}

#[wasm_bindgen]
impl PackedPublication {
    #[wasm_bindgen(getter, js_name = bookId)]
    pub fn book_id(&self) -> Vec<u8> {
        self.book_id.to_vec()
    }

    /// The shard format the publication was packed in.
    #[wasm_bindgen(getter, js_name = formatVersion)]
    pub fn format_version(&self) -> u32 {
        shard::SHARD_FORMAT_VERSION
    }

    /// The skeleton and every content shard.
    #[wasm_bindgen(getter, js_name = shardCount)]
    pub fn shard_count(&self) -> usize {
        self.shards.len()
    }

    #[wasm_bindgen(js_name = shardId)]
    pub fn shard_id(&self, index: usize) -> u32 {
        self.shard(index).shard_id
    }

    #[wasm_bindgen(js_name = shardBytes)]
    pub fn shard_bytes(&self, index: usize) -> Vec<u8> {
        self.shard(index).bytes.clone()
    }

    /// The shard's 32-byte key, when the publication is encrypted.
    #[wasm_bindgen(js_name = shardKey)]
    pub fn shard_key(&self, index: usize) -> Option<Vec<u8>> {
        self.shard(index)
            .key
            .as_ref()
            .map(|key| key.as_bytes().to_vec())
    }

    /// The archive paths the shard carries.
    #[wasm_bindgen(js_name = shardFiles)]
    pub fn shard_files(&self, index: usize) -> Vec<String> {
        self.shard(index).files.clone()
    }
}

impl PackedPublication {
    fn shard(&self, index: usize) -> &shard::PackedShard {
        self.shards
            .get(index)
            .expect("shard index is below shardCount")
    }
}

/// Splits `epub` into shards. `random` fills the `Uint8Array` it is given
/// from a cryptographically secure source; it draws the book id and, with
/// `encrypt`, every key and nonce.
#[wasm_bindgen(js_name = packPublication)]
pub fn pack_publication(
    epub: &[u8],
    encrypt: bool,
    random: &js_sys::Function,
) -> Result<PackedPublication, JsError> {
    let mut fill = |buffer: &mut [u8]| {
        let length = u32::try_from(buffer.len()).expect("random draws are small");
        let view = js_sys::Uint8Array::new_with_length(length);
        random
            .call1(&JsValue::NULL, &view)
            .expect("the random source fills its buffer");
        view.copy_to(buffer);
    };
    let packed = shard::pack_publication(epub, shard::PackOptions { encrypt }, &mut fill)
        .map_err(|error| JsError::new(error.message()))?;
    let mut shards = Vec::with_capacity(packed.shards.len() + 1);
    shards.push(packed.skeleton);
    shards.extend(packed.shards);
    Ok(PackedPublication {
        book_id: packed.book_id,
        shards,
    })
}

/// The verdict of [`check_publication`].
#[wasm_bindgen]
pub struct PublicationCheck {
    error: Option<String>,
    problems: Vec<epub::PublicationProblem>,
}

#[wasm_bindgen]
impl PublicationCheck {
    /// Why the reader cannot read the publication; absent when it can.
    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }

    /// The files the reader shows degraded.
    #[wasm_bindgen(getter, js_name = problemCount)]
    pub fn problem_count(&self) -> usize {
        self.problems.len()
    }

    #[wasm_bindgen(js_name = problemPath)]
    pub fn problem_path(&self, index: usize) -> String {
        self.problem(index).path.clone()
    }

    #[wasm_bindgen(js_name = problemMessage)]
    pub fn problem_message(&self, index: usize) -> String {
        self.problem(index).message.clone()
    }
}

impl PublicationCheck {
    fn problem(&self, index: usize) -> &epub::PublicationProblem {
        self.problems
            .get(index)
            .expect("problem index is below problemCount")
    }
}

/// Whether the reader can read `epub` (see `rito_core::epub::check_publication`).
/// An unreadable publication is a verdict, not an error.
#[wasm_bindgen(js_name = checkPublication)]
pub fn check_publication(epub: &[u8]) -> PublicationCheck {
    match epub::check_publication(epub) {
        Ok(problems) => PublicationCheck {
            error: None,
            problems,
        },
        Err(error) => PublicationCheck {
            error: Some(error.message().to_owned()),
            problems: Vec::new(),
        },
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn wasm_console_error(message: &str);
}

/// On wasm a panic aborts as a bare `unreachable` trap; this start hook
/// reports the panic payload and location to the console first.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn install_panic_report() {
    std::panic::set_hook(Box::new(|info| {
        wasm_console_error(&format!("rito-pack panic: {info}"));
    }));
}
