/**
 * Clean-up for the words (lyrics) under the notes.
 *
 * Optical music recognition often reads the PAGE FOOTER ("This edition produced
 * by ...", "(c) 2012 by CPDL", "Engraving by LilyPond <http://lilypond.org>")
 * as sung words and hangs them under the last notes. Measured on five real
 * scores, that happened in nine of ten readings. This module removes it.
 *
 * It is deliberately cautious. A word is only removed when it belongs to a short
 * run of consecutive syllables that contains a STRONG marker (a web address, an
 * e-mail, a copyright sign, "edition", "CPDL", "LilyPond", ...). Words that are
 * only suspicious on their own ("freely", "may", "by") are removed only when they
 * sit right next to such a marker, so a hymn that really sings "freely" keeps it.
 *
 * Only the drawn sheet is cleaned. Playback does not use lyrics.
 */

/** Text that is page furniture and essentially never sung. */
export const STRONG_MARKER =
  /(https?:|www\.|@|lilypond|cpdl|copyright|[\u00a9\u2117\u00ae]|\bedition\b|engraving|\bproduced\b|\btypeset\b)/i;

/** Weak footer words: removed only when directly beside a strong marker. */
const GLUE_WORDS = new Set([
  "by", "may", "be", "this", "produced", "performed", "recorded", "edited",
  "typeset", "engraved", "arranged", "rights", "reserved", "distributed",
  "duplicated", "freely", "permission", "licensed", "edition", "engraving",
]);
/** Words that may sit INSIDE a footer run (between two footer words), such as "and". */
const INNER_WORDS = new Set(["and", "or", "the", "of", "for", "to", "in", "a", "with", "all"]);
const YEAR = /^(1[5-9]\d\d|20\d\d)([-/](\d{2}|\d{4}))?$/;
const VERSION = /^\d+(\.\d+)+$/;
/** Words after which a person's name usually follows in a credit line. */
const NAME_LEADERS = new Set(["by", "edition", "edited", "arranged", "engraving", "typeset", "produced"]);

export interface LyricToken {
  text: string;
  verse: string;
  part: number;
}

export function normaliseToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9./-]/g, "").replace(/[.,;:!?]+$/, "");
}

const isYearLike = (norm: string) => YEAR.test(norm) || VERSION.test(norm);
const looksLikeName = (text: string) => /^[A-Z\u00c0-\u00de][A-Za-z\u00c0-\u00ff'’-]+[.,]?$/.test(text.trim());

/**
 * Given one line of lyric syllables in sung order, returns which positions are
 * footer text. Pure function so the rules can be tested on their own.
 */
export function findFooterRun(texts: string[]): boolean[] {
  const n = texts.length;
  const norm = texts.map(normaliseToken);
  const marked = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) if (STRONG_MARKER.test(texts[i])) marked[i] = true;
  if (!marked.some(Boolean)) return marked;

  const glue = (i: number) => GLUE_WORDS.has(norm[i]) || isYearLike(norm[i]);

  // 1a. To the LEFT of a strong marker only two glue words are taken
  //     ("This [edition]", "by [CPDL]"), so a real last word is rarely touched.
  for (let i = 0; i < n; i++) {
    if (!STRONG_MARKER.test(texts[i])) continue;
    for (let j = i - 1, steps = 0; j >= 0 && steps < 2 && !marked[j] && glue(j); j--, steps++) {
      marked[j] = true;
    }
  }
  // 1b. To the RIGHT, glue words and years follow in a chain ("May freely duplicated").
  for (let i = 1; i < n; i++) {
    if (!marked[i] && marked[i - 1] && glue(i)) marked[i] = true;
  }

  // 2. Names right after a credit leader ("by Andrew Sims, 2020").
  for (let i = 1; i < n; i++) {
    if (marked[i]) continue;
    if (!marked[i - 1]) continue;
    const leader = NAME_LEADERS.has(norm[i - 1]);
    const afterName = i >= 2 && marked[i - 2] && looksLikeName(texts[i - 1]) && !STRONG_MARKER.test(texts[i - 1]);
    if ((leader || afterName) && looksLikeName(texts[i])) marked[i] = true;
  }
  // Years can follow a name, so run the year/version spread once more to the right.
  for (let i = 1; i < n; i++) {
    if (!marked[i] && marked[i - 1] && isYearLike(norm[i])) marked[i] = true;
  }

  // 3. Fill short gaps INSIDE a footer ("performed, [and] recorded").
  for (let i = 1; i < n - 1; i++) {
    if (marked[i] || !marked[i - 1]) continue;
    let j = i;
    while (j < n && !marked[j] && j - i < 2) j++;
    if (j < n && marked[j] && texts.slice(i, j).every((t) => INNER_WORDS.has(normaliseToken(t)))) {
      for (let k = i; k < j; k++) marked[k] = true;
    }
  }

  // Safety: a line that would be mostly removed is probably not a footer at all.
  const count = marked.filter(Boolean).length;
  // (The longest real footer seen was 12 words, so up to 14 are always allowed.)
  if (count > Math.max(14, n * 0.5)) return new Array<boolean>(n).fill(false);
  return marked;
}

function kids(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1);
}

export interface LyricCleanupResult {
  xml: string;
  removed: string[];
}

/**
 * Removes footer text that was read as lyrics. Returns the original text
 * unchanged (identical string) when nothing needs removing.
 */
export function removeFooterLyrics(source: string): LyricCleanupResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return { xml: source, removed: [] };
  }
  const parts = Array.from(doc.getElementsByTagName("part"));
  const removed: string[] = [];

  parts.forEach((part) => {
    // One sequence per verse line, in the order the notes are written.
    const lines = new Map<string, Array<{ lyric: Element; text: string }>>();
    for (const measure of kids(part).filter((e) => e.tagName === "measure")) {
      for (const note of kids(measure).filter((e) => e.tagName === "note")) {
        for (const lyric of kids(note).filter((e) => e.tagName === "lyric")) {
          const text = kids(lyric).find((e) => e.tagName === "text")?.textContent ?? "";
          if (!text.trim()) continue;
          const verse = lyric.getAttribute("number") || "1";
          const list = lines.get(verse) ?? [];
          list.push({ lyric, text });
          lines.set(verse, list);
        }
      }
    }
    for (const items of lines.values()) {
      const flags = findFooterRun(items.map((i) => i.text));
      flags.forEach((flag, index) => {
        if (!flag) return;
        const { lyric, text } = items[index];
        lyric.parentNode?.removeChild(lyric);
        removed.push(text.trim());
      });
    }
  });

  if (removed.length === 0) return { xml: source, removed };
  return { xml: new XMLSerializer().serializeToString(doc), removed };
}

export interface LyricVerseCheck {
  /** Verse numbers that have far fewer words than the others (words may be missing). */
  suspectVerses: string[];
  counts: Record<string, number>;
}

/**
 * Looks for a verse with far fewer syllables than the rest, which usually means
 * words were lost or attached to the wrong verse (seen in "Away in a Manger").
 * Needs at least three verses to judge, and returns nothing when unsure.
 */
export function checkLyricVerses(source: string): LyricVerseCheck {
  const empty: LyricVerseCheck = { suspectVerses: [], counts: {} };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return empty;
  }
  // Use the part that carries the most lyrics.
  let best: Record<string, number> = {};
  let bestTotal = 0;
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    const counts: Record<string, number> = {};
    for (const lyric of Array.from(part.getElementsByTagName("lyric"))) {
      const text = kids(lyric).find((e) => e.tagName === "text")?.textContent ?? "";
      if (!text.trim() || STRONG_MARKER.test(text)) continue;
      const verse = lyric.getAttribute("number") || "1";
      counts[verse] = (counts[verse] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > bestTotal) {
      best = counts;
      bestTotal = total;
    }
  }
  const verses = Object.keys(best);
  if (verses.length < 3) return { suspectVerses: [], counts: best };
  const sorted = Object.values(best).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median < 8) return { suspectVerses: [], counts: best };
  const suspectVerses = verses.filter((v) => best[v] < median * 0.6);
  return { suspectVerses, counts: best };
}
