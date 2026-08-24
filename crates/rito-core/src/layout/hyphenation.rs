use std::{collections::BTreeMap, sync::OnceLock};

const MIN_WORD_LENGTH: usize = 6;
const MIN_BEFORE: usize = 2;
const MIN_AFTER: usize = 3;
const EN_US_PATTERNS: &str = include_str!("patterns/en_us_patterns.txt");
const EN_US_EXCEPTIONS: &str = include_str!("patterns/en_us_exceptions.txt");

#[derive(Debug, Default)]
struct TrieNode {
    children: BTreeMap<char, TrieNode>,
    levels: Vec<u8>,
}

#[derive(Debug, Default)]
struct HyphenationTrie {
    root: TrieNode,
}

#[derive(Debug)]
struct LangData {
    trie: HyphenationTrie,
    exceptions: BTreeMap<String, Vec<usize>>,
}

static EN_US_DATA: OnceLock<LangData> = OnceLock::new();

pub(crate) fn find_hyphenation_points(word: &str, language: &str) -> Vec<usize> {
    if word.len() < MIN_WORD_LENGTH || !word.is_ascii() {
        return Vec::new();
    }

    let Some(data) = lang_data(language) else {
        return Vec::new();
    };
    let lower = word.to_ascii_lowercase();
    if let Some(points) = data.exceptions.get(&lower) {
        return points.clone();
    }

    find_points_with_trie(&lower, &data.trie, MIN_BEFORE, MIN_AFTER)
}

fn lang_data(language: &str) -> Option<&'static LangData> {
    (language.eq_ignore_ascii_case("en-us")).then(|| EN_US_DATA.get_or_init(load_en_us_data))
}

fn load_en_us_data() -> LangData {
    LangData {
        trie: build_trie(EN_US_PATTERNS.split_whitespace()),
        exceptions: build_exceptions(EN_US_EXCEPTIONS.split_whitespace()),
    }
}

fn build_trie<'a>(patterns: impl IntoIterator<Item = &'a str>) -> HyphenationTrie {
    let mut trie = HyphenationTrie::default();
    for pattern in patterns {
        let parsed = parse_pattern(pattern);
        let mut node = &mut trie.root;
        for character in parsed.chars.chars() {
            node = node.children.entry(character).or_default();
        }
        node.levels = parsed.levels;
    }
    trie
}

fn build_exceptions<'a>(
    entries: impl IntoIterator<Item = &'a str>,
) -> BTreeMap<String, Vec<usize>> {
    let mut exceptions = BTreeMap::new();
    for entry in entries {
        let mut word = String::new();
        let mut points = Vec::new();
        let word_length = entry.chars().filter(|character| *character != '-').count();
        for part in entry.split('-') {
            word.push_str(part);
            if word.len() < word_length {
                points.push(word.len());
            }
        }
        exceptions.insert(word, points);
    }
    exceptions
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedPattern {
    chars: String,
    levels: Vec<u8>,
}

fn parse_pattern(pattern: &str) -> ParsedPattern {
    let mut chars = String::new();
    let mut levels = vec![0];

    for character in pattern.chars() {
        if let Some(digit) = character.to_digit(10) {
            levels[chars.len()] = digit as u8;
        } else {
            chars.push(character);
            if levels.len() <= chars.len() {
                levels.push(0);
            }
        }
    }

    ParsedPattern { chars, levels }
}

fn find_points_with_trie(
    word: &str,
    trie: &HyphenationTrie,
    min_before: usize,
    min_after: usize,
) -> Vec<usize> {
    let padded = format!(".{word}.");
    let chars = padded.chars().collect::<Vec<_>>();
    let mut levels = vec![0_u8; chars.len() + 1];

    for start in 0..chars.len() {
        let mut node = Some(&trie.root);
        for (relative, character) in chars.iter().enumerate().skip(start) {
            node = node.and_then(|node| node.children.get(character));
            let Some(current) = node else {
                break;
            };
            if current.levels.is_empty() {
                continue;
            }
            for (level_index, level) in current.levels.iter().enumerate() {
                let position = start + level_index;
                if position < levels.len() && *level > levels[position] {
                    levels[position] = *level;
                }
            }
            if relative + 1 >= chars.len() {
                break;
            }
        }
    }

    let mut points = Vec::new();
    for position in min_before..=word.len().saturating_sub(min_after) {
        if levels.get(position + 1).is_some_and(|level| level % 2 == 1) {
            points.push(position);
        }
    }
    points
}

#[cfg(test)]
mod tests {
    use super::{build_trie, find_hyphenation_points, find_points_with_trie, parse_pattern};

    #[test]
    fn parses_tex_patterns_into_chars_and_levels() {
        let parsed = parse_pattern(".ach4");

        assert_eq!(parsed.chars, ".ach");
        assert_eq!(parsed.levels, vec![0, 0, 0, 0, 4]);
    }

    #[test]
    fn applies_liang_patterns_for_en_us_words() {
        assert_eq!(find_hyphenation_points("hyphenation", "en-us"), vec![2, 6]);
        assert_eq!(
            find_hyphenation_points("Nokyoushitsue", "en-us"),
            vec![4, 10]
        );
    }

    #[test]
    fn applies_bundled_exceptions() {
        assert_eq!(find_hyphenation_points("associate", "en-us"), vec![2, 4]);
        assert!(find_hyphenation_points("table", "en-us").is_empty());
    }

    #[test]
    fn unsupported_languages_do_not_hyphenate() {
        assert!(find_hyphenation_points("hyphenation", "und").is_empty());
        assert!(find_hyphenation_points("hyphenation", "ja").is_empty());
    }

    #[test]
    fn trie_matching_respects_minimum_edges() {
        let trie = build_trie(["a1bc", "ab3c"]);

        assert_eq!(find_points_with_trie("abcde", &trie, 2, 2), vec![2]);
    }
}
