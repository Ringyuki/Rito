/** Liang's hyphenation algorithm: trie-based pattern matching. */

/**
 * A node in the hyphenation pattern trie.
 * Fields are readonly at the interface level; the Map and array contents
 * are mutated during {@link buildTrie} construction only.
 */
export interface TrieNode {
  readonly children: Map<string, TrieNode>;
  readonly levels: number[];
}

export interface HyphenationTrie {
  readonly root: TrieNode;
}

function createNode(): TrieNode {
  return { children: new Map(), levels: [] };
}

/**
 * Parse a TeX pattern string like ".ach4" into its character string and level
 * array. Digits in the pattern indicate hyphenation levels at each position;
 * letters (and dots) form the matching string.
 */
function parsePattern(pattern: string): { chars: string; levels: number[] } {
  const chars: string[] = [];
  const levels: number[] = [0];

  for (const ch of pattern) {
    if (ch >= '0' && ch <= '9') {
      levels[chars.length] = Number(ch);
    } else {
      chars.push(ch);
      if (levels.length <= chars.length) levels.push(0);
    }
  }

  return { chars: chars.join(''), levels };
}

/** Build a trie from space-delimited TeX hyphenation patterns. */
export function buildTrie(patterns: readonly string[]): HyphenationTrie {
  const root = createNode();

  for (const raw of patterns) {
    const { chars, levels } = parsePattern(raw);
    let node = root;
    for (const ch of chars) {
      let child = node.children.get(ch);
      if (!child) {
        child = createNode();
        node.children.set(ch, child);
      }
      node = child;
    }
    // Store levels on the terminal node
    node.levels.length = 0;
    node.levels.push(...levels);
  }

  return { root };
}

/**
 * Find hyphenation points in a word using Liang's algorithm.
 *
 * The word is padded with dots (`.word.`) and every substring starting
 * position is walked through the trie. At each matching node that carries
 * level data, max-merge the levels into a running array. After all patterns
 * have been applied, positions with an odd level value are valid break points
 * — subject to minBefore/minAfter constraints.
 */
export function findPointsWithTrie(
  word: string,
  trie: HyphenationTrie,
  minBefore: number,
  minAfter: number,
): number[] {
  const padded = `.${word}.`;
  const levels = new Array<number>(padded.length + 1).fill(0);

  for (let i = 0; i < padded.length; i++) {
    let node: TrieNode | undefined = trie.root;
    for (let j = i; j < padded.length && node; j++) {
      const ch = padded[j];
      if (!ch) break;
      node = node.children.get(ch);
      if (node && node.levels.length > 0) {
        for (let k = 0; k < node.levels.length; k++) {
          const level = node.levels[k];
          const pos = i + k;
          if (level !== undefined && pos < levels.length) {
            const existing = levels[pos] ?? 0;
            if (level > existing) levels[pos] = level;
          }
        }
      }
    }
  }

  // Positions in `levels` correspond to padded string positions.
  // The leading '.' shifts word positions by 1: word position p corresponds
  // to levels index p + 1. A break *before* character p in the original word
  // has odd level at index p + 1.
  const points: number[] = [];
  for (let p = minBefore; p <= word.length - minAfter; p++) {
    const level = levels[p + 1];
    if (level !== undefined && level % 2 === 1) {
      points.push(p);
    }
  }

  return points;
}
