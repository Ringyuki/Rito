//! A display list read back as what it paints, wherever its text was cut
//! into runs: consecutive text runs that paint alike — the same paint, line
//! height, link and line — are one stretch of text and clusters, each
//! cluster at its byte in that stretch, its origin and whether it joins the
//! one before it. Every other primitive is kept as its bytes. Two lists
//! that read back alike paint alike, however each cut its text.

use std::ops::Range;

/// The canonical bytes of a `RITODL1` format 4 list.
pub(crate) fn canonical(bytes: &[u8]) -> Result<Vec<u8>, String> {
    walk(bytes, &mut |_| {})
}

/// The canonical list as lines of text, one per primitive and per cluster.
pub(crate) fn describe(bytes: &[u8]) -> Result<String, String> {
    let mut lines = String::new();
    walk(bytes, &mut |line: String| {
        lines.push_str(&line);
        lines.push('\n');
    })?;
    Ok(lines)
}

fn walk(bytes: &[u8], say: &mut dyn FnMut(String)) -> Result<Vec<u8>, String> {
    let mut reader = Reader { bytes, at: 0 };
    if reader.take(7)? != b"RITODL1" {
        return Err("not a RITODL1 list".to_owned());
    }
    let version = reader.u32()?;
    if version != 4 {
        return Err(format!("format {version}"));
    }
    reader.take(8)?;
    let count = reader.u32()?;
    let mut items = Vec::new();
    for _ in 0..count {
        let start = reader.at;
        let opcode = reader.u16()?;
        if opcode == 12 || opcode == 13 {
            items.push(Item::Text(reader.text(opcode)?));
        } else {
            reader.primitive(opcode)?;
            items.push(Item::Bytes(start..reader.at));
        }
    }
    let tables = reader.tables()?;
    let mut out = Vec::new();
    let mut open: Option<Stretch> = None;
    for item in items {
        match item {
            Item::Bytes(range) => {
                if let Some(stretch) = open.take() {
                    stretch.write(&mut out, say);
                }
                say(format!(
                    "primitive {} {}",
                    u16::from_le_bytes([bytes[range.start], bytes[range.start + 1]]),
                    bytes[range.clone()]
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<String>()
                ));
                out.push(0);
                out.extend_from_slice(&bytes[range]);
            }
            Item::Text(run) => {
                let run = Stretch::of(&run, &tables)?;
                match &mut open {
                    Some(stretch) if stretch.continues(&run) => stretch.extend(run),
                    _ => {
                        if let Some(stretch) = open.replace(run) {
                            stretch.write(&mut out, say);
                        }
                    }
                }
            }
        }
    }
    if let Some(stretch) = open {
        stretch.write(&mut out, say);
    }
    Ok(out)
}

enum Item {
    Bytes(Range<usize>),
    Text(TextRef),
}

struct TextRef {
    opcode: u16,
    text: Range<usize>,
    rect: [f64; 4],
    paint: u32,
    tail: Vec<u8>,
    clusters: Range<usize>,
}

struct Tables {
    bytes: Vec<u32>,
    origins: Vec<(u32, u32)>,
    joins: Vec<u8>,
    text: Vec<u8>,
    paints: Vec<Vec<u8>>,
}

/// Text that paints alike: its key, its left and right edges, its text
/// and its clusters at their bytes in it.
struct Stretch {
    key: Vec<u8>,
    left: f64,
    right: f64,
    text: Vec<u8>,
    clusters: Vec<(u32, u32, u32, u8)>,
    /// Each run's left and right edges, for the description.
    runs: Vec<(f64, f64)>,
}

impl Stretch {
    fn of(run: &TextRef, tables: &Tables) -> Result<Self, String> {
        let paint = tables
            .paints
            .get(run.paint as usize)
            .ok_or("paint index past the table")?;
        let mut key = run.opcode.to_le_bytes().to_vec();
        key.extend_from_slice(paint);
        key.extend_from_slice(&run.tail);
        key.extend_from_slice(&run.rect[1].to_bits().to_le_bytes());
        key.extend_from_slice(&run.rect[3].to_bits().to_le_bytes());
        let text = tables
            .text
            .get(run.text.clone())
            .ok_or("text past the table")?
            .to_vec();
        let clusters = run
            .clusters
            .clone()
            .map(|index| {
                let (x, y) = tables.origins[index];
                (tables.bytes[index], x, y, tables.joins[index])
            })
            .collect();
        Ok(Self {
            key,
            left: run.rect[0],
            right: run.rect[0] + run.rect[2],
            text,
            clusters,
            runs: vec![(run.rect[0], run.rect[0] + run.rect[2])],
        })
    }

    /// Only text runs continue one another: an annotation stands alone.
    fn continues(&self, next: &Stretch) -> bool {
        self.key == next.key && self.key[..2] == 12u16.to_le_bytes()
    }

    fn extend(&mut self, next: Stretch) {
        let offset = self.text.len() as u32;
        self.text.extend_from_slice(&next.text);
        self.clusters.extend(
            next.clusters
                .into_iter()
                .map(|(byte, x, y, joins)| (byte + offset, x, y, joins)),
        );
        self.right = next.right;
        self.runs.extend(next.runs);
    }

    fn write(&self, out: &mut Vec<u8>, say: &mut dyn FnMut(String)) {
        say(format!(
            "text key {} left {} right {} {:?}",
            self.key
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            self.left,
            self.right,
            String::from_utf8_lossy(&self.text)
        ));
        say(format!("  runs {:?}", self.runs));
        for (byte, x, y, joins) in &self.clusters {
            say(format!(
                "  cluster {byte} {} {} {joins}",
                f32::from_bits(*x),
                f32::from_bits(*y)
            ));
        }
        out.push(1);
        out.extend_from_slice(&self.key);
        // The right edge is not held: it is summed differently where runs
        // were cut, and a run that paints only glyphs reads it only for the
        // ground it sits on.
        out.extend_from_slice(&self.left.to_bits().to_le_bytes());
        out.extend_from_slice(&(self.text.len() as u32).to_le_bytes());
        out.extend_from_slice(&self.text);
        for (byte, x, y, joins) in &self.clusters {
            out.extend_from_slice(&byte.to_le_bytes());
            out.extend_from_slice(&x.to_le_bytes());
            out.extend_from_slice(&y.to_le_bytes());
            out.push(*joins);
        }
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(length).ok_or("length overflow")?;
        let slice = self.bytes.get(self.at..end).ok_or("truncated")?;
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().map_err(|_| "u16")?,
        ))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().map_err(|_| "u32")?,
        ))
    }

    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(
            self.take(8)?.try_into().map_err(|_| "f64")?,
        ))
    }

    fn skip_f64s(&mut self, count: usize) -> Result<(), String> {
        self.take(count * 8).map(|_| ())
    }

    fn string(&mut self) -> Result<(), String> {
        let length = self.u32()? as usize;
        self.take(length).map(|_| ())
    }

    fn option(&mut self) -> Result<bool, String> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            tag => Err(format!("option tag {tag}")),
        }
    }

    fn color(&mut self) -> Result<(), String> {
        self.take(18).map(|_| ())
    }

    fn ground(&mut self) -> Result<(), String> {
        if self.u8()? == 3 {
            self.skip_f64s(4)?;
        }
        Ok(())
    }

    fn path(&mut self) -> Result<(), String> {
        for _ in 0..self.u32()? {
            match self.u8()? {
                1 | 2 => self.skip_f64s(2)?,
                3 => self.skip_f64s(6)?,
                4 | 5 => self.skip_f64s(4)?,
                6 => {}
                tag => return Err(format!("path op {tag}")),
            }
        }
        Ok(())
    }

    fn primitive(&mut self, opcode: u16) -> Result<(), String> {
        match opcode {
            1 | 2 => Ok(()),
            3 => self.skip_f64s(2),
            4 => self.skip_f64s(1),
            5 => {
                self.skip_f64s(2)?;
                for _ in 0..self.u32()? {
                    match self.u8()? {
                        1 => self.skip_f64s(1)?,
                        _ => self.skip_f64s(2)?,
                    }
                }
                Ok(())
            }
            6 => self.path(),
            7 => {
                self.skip_f64s(4)?;
                self.color()?;
                self.ground()
            }
            8 => {
                self.path()?;
                self.u8()?;
                self.color()?;
                self.ground()
            }
            9 => {
                self.path()?;
                self.skip_f64s(1)?;
                self.color()?;
                self.u8()?;
                if self.option()? {
                    self.skip_f64s(2)?;
                }
                Ok(())
            }
            10 => {
                self.path()?;
                self.skip_f64s(3)?;
                self.color()?;
                if self.option()? {
                    self.path()?;
                }
                Ok(())
            }
            11 => {
                self.string()?;
                self.skip_f64s(4)?;
                if self.option()? {
                    self.skip_f64s(4)?;
                }
                if self.option()? {
                    self.skip_f64s(4)?;
                    self.take(8)?;
                }
                Ok(())
            }
            14 => {
                self.string()?;
                self.u8()?;
                self.skip_f64s(6)?;
                for _ in 0..self.u32()? {
                    self.skip_f64s(2)?;
                    if self.option()? {
                        self.path()?;
                    }
                    self.path()?;
                }
                Ok(())
            }
            opcode => Err(format!("opcode {opcode}")),
        }
    }

    fn text(&mut self, opcode: u16) -> Result<TextRef, String> {
        let byte_start = self.u32()? as usize;
        let byte_length = self.u32()? as usize;
        self.take(8)?;
        let rect = [self.f64()?, self.f64()?, self.f64()?, self.f64()?];
        let paint = self.u32()?;
        let tail_start = self.at;
        if self.option()? {
            self.skip_f64s(1)?;
        }
        if self.option()? {
            self.string()?;
        }
        if self.option()? {
            self.string()?;
        }
        if self.option()? {
            self.take(8)?;
        }
        let tail = self.bytes[tail_start..self.at].to_vec();
        let start = self.u32()? as usize;
        let count = self.u32()? as usize;
        Ok(TextRef {
            opcode,
            text: byte_start..byte_start + byte_length,
            rect,
            paint,
            tail,
            clusters: start..start + count,
        })
    }

    fn tables(&mut self) -> Result<Tables, String> {
        let count = self.u32()? as usize;
        while !self.at.is_multiple_of(4) {
            self.u8()?;
        }
        let mut bytes = Vec::with_capacity(count);
        for _ in 0..count {
            bytes.push(self.u32()?);
        }
        let mut origins = Vec::with_capacity(count);
        for _ in 0..count {
            origins.push((self.u32()?, self.u32()?));
        }
        let joins = self.take(count)?.to_vec();
        let text_length = self.u32()? as usize;
        let text = self.take(text_length)?.to_vec();
        let mut paints = Vec::new();
        for _ in 0..self.u32()? {
            let start = self.at;
            self.string()?;
            self.skip_f64s(2)?;
            self.u8()?;
            self.color()?;
            for _ in 0..self.u32()? {
                self.skip_f64s(3)?;
                self.color()?;
            }
            paints.push(self.bytes[start..self.at].to_vec());
        }
        Ok(Tables {
            bytes,
            origins,
            joins,
            text,
            paints,
        })
    }
}
