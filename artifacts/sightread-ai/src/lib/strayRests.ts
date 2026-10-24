/**
 * Hides duplicate rests that optical music recognition leaves behind when it
 * moves notes into another voice, for the DRAWN sheet only.
 *
 * Seen in a real reading of "Ding Dong! Merrily on High": on the upper staff
 * the stacked notes of beats 3 and 4 were written as a separate third voice,
 * while the second voice kept a quarter rest over exactly that time. The viewer
 * draws that rest in the gap between the two staves, under the beamed notes,
 * even though the printed page has no rest there.
 *
 * Rule (conservative): a rest is hidden only when notes of a THIRD voice on the
 * same staff (not the rest's own voice and not the main line, voice 1) cover
 * its entire length. A rest that is only "covered" by the main line is a normal
 * resting inner voice and is kept.
 *
 * The rest is swapped for an invisible <forward> of the same length, so every
 * note after it keeps exactly the same position in the bar. Nothing is
 * removed from the playback score: this is applied to the drawn text only, and
 * a rest makes no sound anyway. If nothing needs changing the original text is
 * returned unchanged.
 */
const EPS = 1e-6;

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function directChild(parent: Element, tag: string): Element | undefined {
  return childElements(parent).find((el) => el.tagName === tag);
}

interface Span {
  node: Element;
  voice: string;
  staff: string;
  start: number;
  end: number;
  isRest: boolean;
}

function readSpans(measure: Element): Span[] | null {
  const spans: Span[] = [];
  let cursor = 0;
  for (const child of childElements(measure)) {
    if (child.tagName === "backup" || child.tagName === "forward") {
      const d = Number(directChild(child, "duration")?.textContent);
      if (!Number.isFinite(d) || d < 0) return null;
      cursor = child.tagName === "backup" ? Math.max(0, cursor - d) : cursor + d;
      continue;
    }
    if (child.tagName !== "note" || directChild(child, "grace")) continue;
    const d = Number(directChild(child, "duration")?.textContent);
    if (!Number.isFinite(d) || d <= 0) return null;
    const isChord = !!directChild(child, "chord");
    const last = spans[spans.length - 1];
    const start = isChord && last ? last.start : cursor;
    const end = isChord && last ? last.end : cursor + d;
    if (!isChord) cursor += d;
    spans.push({
      node: child,
      voice: directChild(child, "voice")?.textContent?.trim() || "1",
      staff: directChild(child, "staff")?.textContent?.trim() || "1",
      start,
      end,
      isRest: !!directChild(child, "rest"),
    });
  }
  return spans;
}

/** True when the sounding spans together cover [start, end] with no gap. */
function covers(spans: Span[], start: number, end: number): boolean {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let reach = start;
  for (const span of sorted) {
    if (span.start > reach + EPS) return false;
    reach = Math.max(reach, span.end);
    if (reach >= end - EPS) return true;
  }
  return reach >= end - EPS;
}

/** Returns the score text with duplicate rests made invisible, or the original text. */
export function hideDuplicateVoiceRests(source: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return source;
  }

  let changed = false;
  for (const measure of Array.from(doc.getElementsByTagName("measure"))) {
    const spans = readSpans(measure);
    if (!spans) continue;

    for (const rest of spans.filter((span) => span.isRest)) {
      // Leave rests that carry tuplet or other notation alone.
      if (directChild(rest.node, "notations") || directChild(rest.node, "time-modification")) continue;

      const thirdVoice = spans.filter(
        (span) =>
          !span.isRest &&
          span.staff === rest.staff &&
          span.voice !== rest.voice &&
          span.voice !== "1",
      );
      if (thirdVoice.length === 0 || rest.voice === "1") continue;
      if (!covers(thirdVoice, rest.start, rest.end)) continue;

      const forward = doc.createElement("forward");
      const dur = doc.createElement("duration");
      dur.textContent = directChild(rest.node, "duration")?.textContent ?? "0";
      forward.appendChild(dur);
      const voice = doc.createElement("voice");
      voice.textContent = rest.voice;
      forward.appendChild(voice);
      if (directChild(rest.node, "staff")) {
        const staff = doc.createElement("staff");
        staff.textContent = rest.staff;
        forward.appendChild(staff);
      }
      measure.replaceChild(forward, rest.node);
      changed = true;
    }
  }

  if (!changed) return source;
  return new XMLSerializer().serializeToString(doc);
}
