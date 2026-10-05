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

  const parts = Array.from(doc.getElementsByTagName("part"));
  if (parts.length === 0) return musicXmlSource;

  const firstMeasures = parts.map((part) =>
    Array.from(part.childNodes).filter(
      (node): node is Element =>
        node.nodeType === 1 && (node as Element).tagName === "measure",
    ),
  );

  if (firstMeasures.some((measures) => measures.length < 2)) {
    return musicXmlSource; // nothing to safely compare against
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
  if (!allUnanimous) return musicXmlSource;

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

  return new XMLSerializer().serializeToString(doc);
}
