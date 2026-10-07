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
 * over bass) as ONE voice of stacked two-note chords. Downstream, that means
 * a singer can only practise the whole staff as a unit.
 *
 * This pass rewrites such a part so the top note of every pair is voice 1
 * and the lower note is voice 2 (joined by a <backup>), which is what
 * expandPracticeTracks needs to offer Soprano/Alto/Tenor/Bass individually.
 *
 * It is deliberately all-or-nothing per part. It does nothing unless:
 *   - the part has a single staff
 *   - every note is voice 1 (or has no voice), with no grace or unpitched
 *     notes and no existing <backup>/<forward>
 *   - every pitched note belongs to a stack of EXACTLY two notes, and each
 *     pair shares one duration and has two different, readable pitches
 *   - there is at least one such pair
 * A part with any single (unstacked) pitched note, a 3-note chord, a
 * unison pair, or an existing second voice is left byte-for-byte alone.
 *
 * Rests are mirrored into voice 2 so both voices fill every measure. Lyrics
 * stay on the top note only.
 */
export function splitStackedChordsIntoVoices(doc: Document): boolean {
  let changed = false;
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    if (trySplitPart(doc, part)) changed = true;
  }
  return changed;
}

type NotePair = { first: Element; second: Element };

function trySplitPart(doc: Document, part: Element): boolean {
  const measures = childElements(part).filter((el) => el.tagName === "measure");
  if (measures.length === 0) return false;

  // ---- Validation (no mutation until everything passes) ----
  const pairsByMeasure = new Map<Element, NotePair[]>();
  let pairCount = 0;

  for (const measure of measures) {
    const pairs: NotePair[] = [];
    let previous: Element | null = null;
    let open: NotePair | null = null;

    for (const child of childElements(measure)) {
      if (child.tagName === "backup" || child.tagName === "forward") return false;
      if (child.tagName !== "note") continue;

      if (directChild(child, "grace") || directChild(child, "unpitched"))
        return false;
      const staff = directChild(child, "staff")?.textContent?.trim();
      if (staff && staff !== "1") return false;
      const voice = directChild(child, "voice")?.textContent?.trim();
      if (voice && voice !== "1") return false;

      const isChord = !!directChild(child, "chord");
      const isRest = !!directChild(child, "rest");

      if (isChord) {
        // A chord note must follow a pitched, non-rest, non-chord note.
        if (isRest || !previous || directChild(previous, "rest")) return false;
        if (open) return false; // third note in a stack
        if (!open) {
          const prevIsChord = !!directChild(previous, "chord");
          if (prevIsChord) return false;
          open = { first: previous, second: child };
          pairs.push(open);
        }
      } else {
        // A new non-chord note closes any open stack; the previous note must
        // have been part of a pair if it was pitched.
        if (previous && !directChild(previous, "rest")) {
          const prevIsChord = !!directChild(previous, "chord");
          if (!prevIsChord && !(open && open.first === previous)) return false;
        }
        open = null;
      }
      previous = child;
    }
    // The final pitched note of the measure must also be paired.
    if (previous && !directChild(previous, "rest")) {
      const prevIsChord = !!directChild(previous, "chord");
      const lastPair = pairs[pairs.length - 1];
      if (!prevIsChord || !lastPair || lastPair.second !== previous) return false;
    }

    for (const pair of pairs) {
      const d1 = noteDuration(pair.first);
      const d2 = noteDuration(pair.second);
      if (d1 === null || d2 === null || d1 !== d2) return false;
      const p1 = pitchValue(pair.first);
      const p2 = pitchValue(pair.second);
      if (p1 === null || p2 === null || p1 === p2) return false;
    }
    pairCount += pairs.length;
    pairsByMeasure.set(measure, pairs);
  }
  if (pairCount === 0) return false;

  // ---- Rewrite ----
  for (const measure of measures) {
    const pairs = pairsByMeasure.get(measure) ?? [];
    if (pairs.length === 0) continue; // rest-only measure: nothing to split

    const upper: Element[] = []; // voice 1 line, in order (no chord notes)
    const lower: Element[] = []; // voice 2 line, same timing
    let total = 0;
    const pairOf = new Map<Element, NotePair>();
    for (const pair of pairs) {
      pairOf.set(pair.first, pair);
      pairOf.set(pair.second, pair);
    }

    let lastNote: Element | null = null;
    for (const child of childElements(measure)) {
      if (child.tagName !== "note") continue;
      lastNote = child;
      const pair = pairOf.get(child);
      if (pair) {
        if (child !== pair.first) continue; // handled with its partner
        const firstIsTop = pitchValue(pair.first)! > pitchValue(pair.second)!;
        const top = firstIsTop ? pair.first : pair.second;
        const low = firstIsTop ? pair.second : pair.first;

        const topChord = directChild(top, "chord");
        if (topChord) top.removeChild(topChord);
        const lowChord = directChild(low, "chord");
        if (lowChord) low.removeChild(lowChord);

        if (!firstIsTop) {
          // Top note was listed second: put it where the pair started.
          measure.insertBefore(top, pair.first);
        }
        measure.removeChild(low);

        setVoice(doc, top, "1");
        setVoice(doc, low, "2");
        const topStem = directChild(top, "stem");
        if (topStem) topStem.textContent = "up";
        const lowStem = directChild(low, "stem");
        if (lowStem) lowStem.textContent = "down";
        for (const lyric of Array.from(low.childNodes)) {
          if ((lyric as Element).tagName === "lyric") low.removeChild(lyric);
        }
        upper.push(top);
        lower.push(low);
        total += noteDuration(top)!;
      } else if (directChild(child, "rest")) {
        const mirror = child.cloneNode(true) as Element;
        for (const c of Array.from(mirror.childNodes)) {
          if ((c as Element).tagName === "lyric") mirror.removeChild(c);
        }
        setVoice(doc, mirror, "2");
        setVoice(doc, child, "1");
        upper.push(child);
        lower.push(mirror);
        total += noteDuration(child) ?? 0;
      }
    }

    // Insert backup + voice 2 line right after the last note of the measure.
    const lastVoice1 = upper[upper.length - 1] ?? lastNote;
    if (!lastVoice1) continue;
    const backup = doc.createElement("backup");
    const duration = doc.createElement("duration");
    duration.textContent = String(total);
    backup.appendChild(duration);
    let anchor: Node | null = lastVoice1.nextSibling;
    measure.insertBefore(backup, anchor);
    for (const el of lower) measure.insertBefore(el, anchor);
  }
  return true;
}
