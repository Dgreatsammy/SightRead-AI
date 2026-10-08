import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
} from "@xmldom/xmldom";

/**
 * Audiveris frequently misreads the small "ambitus" range-indicator glyph
 * that engravers (notably LilyPond) print just before the clef on choral
 * scores — the tiny two-note chord showing each voice's vocal range — as a
 * genuine one-beat pickup measure. Two concrete, observed problems result:
 *
 * 1. The piece gains one extra fake measure at the start, shifting every
 *    subsequent measure's barline relative to the real printed score.
 * 2. Worse, the *first lyric syllable* of the piece gets attached to this
 *    fake measure's note instead of the real first note, silently vanishing
 *    from the real first measure and shifting every later syllable's
 *    apparent position by one — this is what makes the lyrics look
 *    scrambled even though each real note's *music* (pitch/rhythm) is
 *    usually fine.
 *
 * This function detects that specific, narrow pattern and repairs it:
 *   - only triggers when EVERY part's first measure is implicit and holds
 *     well under a full measure's worth of duration (conservative, so a
 *     real short pickup measure that happens to exist in a piece is left
 *     alone unless the piece is unanimous about it being bogus)
 *   - carries forward any <attributes> (divisions/key/time/clef) the fake
 *     measure held, since Audiveris sometimes puts the real first
 *     declarations there
 *   - moves any lyric on the fake measure's notes onto the first note of
 *     the same voice in the real first measure, rather than discarding it
 *   - removes the fake measure afterward, so the measure count and
 *     barlines match the real score again
 *
 * Returns the input unchanged if the pattern isn't unanimously present, so
 * this never alters output from a clean, non-Audiveris MusicXML source.
 */
export function sanitizeAudiverisMusicXml(musicXmlSource: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(musicXmlSource, "application/xml");
  } catch {
    return musicXmlSource;
  }

  // Each pass is conservative and reports whether it changed anything. The
  // source string is returned untouched (byte-for-byte) unless one did.
  const removedFakeMeasure = removeFakeLeadingMeasure(doc);
  const splitChords = splitStackedChordsIntoVoices(doc);
  if (!removedFakeMeasure && !splitChords) return musicXmlSource;

  return new XMLSerializer().serializeToString(doc);
}

/** Pass 1: see the doc comment on sanitizeAudiverisMusicXml. */
function removeFakeLeadingMeasure(doc: Document): boolean {
  const parts = Array.from(doc.getElementsByTagName("part"));
  if (parts.length === 0) return false;

  const firstMeasures = parts.map((part) =>
    Array.from(part.childNodes).filter(
      (node): node is Element =>
        node.nodeType === 1 && (node as Element).tagName === "measure",
    ),
  );

  if (firstMeasures.some((measures) => measures.length < 2)) {
    return false; // nothing to safely compare against
  }

  const isSuspiciousLeadingMeasure = (measure: Element): boolean => {
    if (measure.getAttribute("implicit") !== "yes") return false;

    const timeEl = measure.getElementsByTagName("time")[0];
    const divisionsEl = measure.getElementsByTagName("divisions")[0];
    if (!timeEl || !divisionsEl) return false;

    const beats = Number(timeEl.getElementsByTagName("beats")[0]?.textContent);
    const beatType = Number(
      timeEl.getElementsByTagName("beat-type")[0]?.textContent,
    );
    const divisions = Number(divisionsEl.textContent);
    if (!beats || !beatType || !divisions) return false;

    const fullMeasureDuration = beats * (4 / beatType) * divisions;

    // Sum duration per voice independently — each voice's own notes should
    // span the full measure, so summing across voices would overstate how
    // much is really there (two 1-beat voices isn't a 2-beat measure).
    const notes = Array.from(measure.getElementsByTagName("note"));
    const voiceTotals = new Map<string, number>();
    for (const note of notes) {
      if (note.getElementsByTagName("chord").length > 0) continue;
      const dur = Number(note.getElementsByTagName("duration")[0]?.textContent);
      if (!dur) continue;
      const voice = note.getElementsByTagName("voice")[0]?.textContent ?? "1";
      voiceTotals.set(voice, (voiceTotals.get(voice) ?? 0) + dur);
    }
    if (voiceTotals.size === 0) return false;

    // Conservative: only treat it as bogus if every voice holds at most a
    // quarter of a full measure's duration — a real short pickup is almost
    // always at least a beat or two, not a single fractional sliver. The
    // observed Audiveris artifact lands at exactly 25% (one beat of 4/4),
    // hence <=.
    return Array.from(voiceTotals.values()).every(
      (total) => total <= fullMeasureDuration * 0.25,
    );
  };

  const allUnanimous = firstMeasures.every(([first]) =>
    isSuspiciousLeadingMeasure(first),
  );
  if (!allUnanimous) return false;

  for (let i = 0; i < parts.length; i++) {
    const [fakeMeasure, realMeasure] = firstMeasures[i];

    // Carry forward <attributes> (divisions/key/time/clef) if the real
    // first measure doesn't already declare its own.
    const fakeAttributes = fakeMeasure.getElementsByTagName("attributes")[0];
    const realAttributes = realMeasure.getElementsByTagName("attributes")[0];
    if (fakeAttributes && !realAttributes) {
      realMeasure.insertBefore(fakeAttributes, realMeasure.firstChild);
    }

    // Move each voice's lyric forward onto the matching first note of the
    // real measure, rather than losing it. That target note very often
    // already carries its own (correct) word — there is no empty slot to
    // drop the orphaned syllable into without re-deriving the whole voice's
    // note-to-syllable alignment, which this function doesn't attempt. The
    // safe middle ground: merge the orphaned word onto the front of
    // whatever text is already there, so nothing silently vanishes, rather
    // than losing it the way the raw Audiveris output does today.
    const fakeNotes = Array.from(fakeMeasure.getElementsByTagName("note"));
    for (const fakeNote of fakeNotes) {
      const lyric = fakeNote.getElementsByTagName("lyric")[0];
      const orphanedText = lyric?.getElementsByTagName("text")[0]?.textContent;
      if (!lyric || !orphanedText) continue;

      const voice = fakeNote.getElementsByTagName("voice")[0]?.textContent;
      const targetNote = Array.from(
        realMeasure.getElementsByTagName("note"),
      ).find(
        (note) =>
          note.getElementsByTagName("voice")[0]?.textContent === voice,
      );
      if (!targetNote) continue;

      const targetLyric = targetNote.getElementsByTagName("lyric")[0];
      const targetTextEl = targetLyric?.getElementsByTagName("text")[0];
      if (targetTextEl && targetTextEl.textContent) {
        targetTextEl.textContent = `${orphanedText} ${targetTextEl.textContent}`;
      } else if (targetLyric) {
        // Lyric element exists but has no text node for some reason.
        targetLyric.appendChild(lyric.firstChild ?? doc.createTextNode(""));
      } else {
        // No lyric at all on the target note yet — safe to attach as-is.
        targetNote.appendChild(lyric);
      }
    }

    fakeMeasure.parentNode?.removeChild(fakeMeasure);
  }

  return true;
}

/* -------------------------------------------------------------------------
 * Pass 2: split stacked two-note chords into two voices.
 * ---------------------------------------------------------------------- */

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function directChild(parent: Element, tag: string): Element | undefined {
  return childElements(parent).find((el) => el.tagName === tag);
}

function pitchValue(note: Element): number | null {
  const pitch = directChild(note, "pitch");
  if (!pitch) return null;
  const step = STEP_SEMITONES[directChild(pitch, "step")?.textContent ?? ""];
  const octave = Number(directChild(pitch, "octave")?.textContent);
  const alterText = directChild(pitch, "alter")?.textContent;
  const alter = alterText ? Number(alterText) : 0;
  if (step === undefined || !Number.isFinite(octave) || !Number.isFinite(alter))
    return null;
  return octave * 12 + step + alter;
}

function noteDuration(note: Element): number | null {
  const value = Number(directChild(note, "duration")?.textContent);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Sets <voice> on a note, creating it in schema position if missing. */
function setVoice(doc: Document, note: Element, voice: string): void {
  const existing = directChild(note, "voice");
  if (existing) {
    existing.textContent = voice;
    return;
  }
  const el = doc.createElement("voice");
  el.textContent = voice;
  // MusicXML order: ... duration, tie*, voice, type ...
  const anchor = [...childElements(note)]
    .reverse()
    .find((c) => c.tagName === "duration" || c.tagName === "tie");
  if (anchor) note.insertBefore(el, anchor.nextSibling);
  else note.appendChild(el);
}

/**
 * Audiveris often reads a two-voice choral staff (soprano over alto, tenor
 * over bass) as ONE voice of stacked chords. Downstream, that means a singer
 * can only practise the whole staff as a unit.
 *
 * This pass rewrites such a part so the top note of every stack is voice 1
 * and the bottom note is voice 2 (joined by a <backup>), which is what
 * expandPracticeTracks needs to offer Soprano/Alto/Tenor/Bass individually.
 *
 * Real OMR output is rarely perfectly clean, so the decision is made on the
 * PART as a whole, and the repair is tolerant of a minority of oddities:
 *   - The part must have one staff; at least MIN_STACK_RATIO of its pitched
 *     note-groups must be stacks, and at least MIN_PAIR_SHARE of those stacks
 *     must be exactly two notes. A genuinely single-voice part (a melody, or
 *     a part whose voices are already split with <backup>) has no stacks and
 *     is left byte-for-byte alone.
 *   - Within a qualifying part, a lone note is treated as both voices
 *     singing the same pitch (voice 2 gets a unison copy), and a stack of
 *     three or more keeps only its highest and lowest notes (the extra
 *     middle note is almost always an OMR artefact).
 *   - A measure that already has <backup>/<forward>, a voice other than 1,
 *     grace/unpitched notes, or a stack whose two notes differ in duration
 *     is skipped and left exactly as Audiveris wrote it.
 * Rests are mirrored into voice 2. Lyrics stay on the top note only.
 */
// At least half of all note-groups must be stacks (2+ notes), and at least
// 60% of those stacks must be exactly two notes. Tuned against real, noisy
// Audiveris output where only ~55% of groups were clean pairs.
const MIN_STACK_RATIO = 0.5;
const MIN_PAIR_SHARE = 0.6;
const MIN_GROUPS = 4;

export function splitStackedChordsIntoVoices(doc: Document): boolean {
  let changed = false;
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    if (trySplitPart(doc, part)) changed = true;
  }
  return changed;
}

type MeasurePlan = {
  measure: Element;
  groups: Element[][]; // pitched note-groups in order
  items: Array<Element[]>; // groups and rests, in document order
};

function planMeasure(measure: Element): MeasurePlan | null {
  const items: Array<Element[]> = [];
  const groups: Element[][] = [];
  for (const child of childElements(measure)) {
    if (child.tagName === "backup" || child.tagName === "forward") return null;
    if (child.tagName !== "note") continue;
    if (directChild(child, "grace") || directChild(child, "unpitched"))
      return null;
    const voice = directChild(child, "voice")?.textContent?.trim();
    if (voice && voice !== "1") return null;
    const isRest = !!directChild(child, "rest");
    const isChord = !!directChild(child, "chord");
    if (isRest) {
      if (isChord) return null;
      items.push([child]);
    } else if (isChord) {
      const last = items[items.length - 1];
      if (!last || directChild(last[0], "rest")) return null;
      last.push(child);
    } else {
      const group = [child];
      items.push(group);
      groups.push(group);
    }
  }
  for (const group of groups) {
    for (const note of group) if (pitchValue(note) === null) return null;
    // Stacks must share one duration or timing cannot be preserved.
    const d0 = noteDuration(group[0]);
    if (d0 === null) return null;
    if (group.some((note) => noteDuration(note) !== d0)) return null;
  }
  return { measure, groups, items };
}

function trySplitPart(doc: Document, part: Element): boolean {
  const measures = childElements(part).filter((el) => el.tagName === "measure");
  if (measures.length === 0) return false;

  // One staff only.
  for (const note of Array.from(part.getElementsByTagName("note"))) {
    const staff = directChild(note, "staff")?.textContent?.trim();
    if (staff && staff !== "1") return false;
  }

  // Gate on the part as a whole, counting every measure (including ones we
  // will later skip) so one odd measure can't hide or fake the pattern.
  let totalGroups = 0;
  let pairGroups = 0;
  let stackGroups = 0;
  const plans: MeasurePlan[] = [];
  for (const measure of measures) {
    let hasChord = false;
    let measureGroups = 0;
    let measurePairs = 0;
    let sizes: number[] = [];
    let cur = 0;
    for (const note of childElements(measure)) {
      if (note.tagName !== "note" || directChild(note, "rest")) continue;
      if (directChild(note, "chord")) {
        cur++;
        hasChord = true;
      } else {
        if (cur) sizes.push(cur);
        cur = 1;
      }
    }
    if (cur) sizes.push(cur);
    measureGroups = sizes.length;
    measurePairs = sizes.filter((n) => n === 2).length;
    totalGroups += measureGroups;
    pairGroups += measurePairs;
    stackGroups += sizes.filter((n) => n >= 2).length;
    void hasChord;
    const plan = planMeasure(measure);
    if (plan && plan.groups.length > 0) plans.push(plan);
  }
  if (totalGroups < MIN_GROUPS) return false;
  if (stackGroups / totalGroups < MIN_STACK_RATIO) return false;
  if (pairGroups / stackGroups < MIN_PAIR_SHARE) return false;
  if (plans.length === 0) return false;

  // Rewrite.
  let changed = false;
  for (const { measure, items } of plans) {
    const upper: Element[] = [];
    const lower: Element[] = [];
    let total = 0;
    const first = items[0][0];
    void first;

    for (const group of items) {
      if (directChild(group[0], "rest")) {
        const rest = group[0];
        const mirror = rest.cloneNode(true) as Element;
        stripForVoiceTwo(mirror);
        setVoice(doc, rest, "1");
        setVoice(doc, mirror, "2");
        upper.push(rest);
        lower.push(mirror);
        total += noteDuration(rest) ?? 0;
        continue;
      }
      const sorted = [...group].sort((x, y) => pitchValue(y)! - pitchValue(x)!);
      const top = sorted[0];
      let low: Element;
      if (sorted.length === 1) {
        low = top.cloneNode(true) as Element; // unison copy for voice 2
      } else {
        low = sorted[sorted.length - 1];
      }

      // Position: keep the top note where the group started.
      const groupStart = group[0];
      for (const note of group) {
        const chord = directChild(note, "chord");
        if (chord) note.removeChild(chord);
      }
      if (top !== groupStart) measure.insertBefore(top, groupStart);
      for (const note of group) {
        if (note !== top) measure.removeChild(note);
      }
      stripForVoiceTwo(low);

      setVoice(doc, top, "1");
      setVoice(doc, low, "2");
      const topStem = directChild(top, "stem");
      if (topStem && sorted.length > 1) topStem.textContent = "up";
      const lowStem = directChild(low, "stem");
      if (lowStem && sorted.length > 1) lowStem.textContent = "down";
      upper.push(top);
      lower.push(low);
      total += noteDuration(top)!;
    }

    const lastUpper = upper[upper.length - 1];
    const anchor: Node | null = lastUpper.nextSibling;
    const backup = doc.createElement("backup");
    const duration = doc.createElement("duration");
    duration.textContent = String(total);
    backup.appendChild(duration);
    measure.insertBefore(backup, anchor);
    for (const el of lower) measure.insertBefore(el, anchor);
    changed = true;
  }
  return changed;
}

/** Removes lyrics and one-off notations that belong to the top line only. */
function stripForVoiceTwo(note: Element): void {
  for (const child of Array.from(note.childNodes)) {
    const tag = (child as Element).tagName;
    if (tag === "lyric" || tag === "notations" || tag === "beam")
      note.removeChild(child);
  }
}
