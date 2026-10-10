import { useEffect, useState } from "react";
import type {
  MusicalPlaybackEngine,
  PlaybackDiagnostics,
} from "@/lib/playback";

/**
 * A small readout of how smoothly the audio timing is running on THIS device.
 * Hidden unless the page address contains ?debug=playback, so ordinary users
 * never see it. Play for a minute, then take a screenshot of it.
 */
export function isPlaybackDebugRequested(search = window.location.search) {
  return new URLSearchParams(search).get("debug") === "playback";
}

export function PlaybackDiagnosticsPanel({
  getEngine,
}: {
  getEngine: () => MusicalPlaybackEngine | null;
}) {
  const [data, setData] = useState<PlaybackDiagnostics | null>(null);

  useEffect(() => {
    const interval = window.setInterval(
      () => setData(getEngine()?.getDiagnostics() ?? null),
      500,
    );
    return () => window.clearInterval(interval);
  }, [getEngine]);

  const rows: Array<[string, string | number | null]> = data
    ? [
        ["timing code", data.engine],
        ["audio", data.contextState],
        ["sample rate", data.sampleRate],
        ["base latency ms", data.baseLatencyMs],
        ["output latency ms", data.outputLatencyMs],
        ["timer ticks", data.ticks],
        ["longest gap ms", data.maxTickGapMs],
        ["gaps > 60 ms", data.slowTicks],
        ["freezes > 150 ms", data.stalls],
        ["notes played", data.notesPlayed],
        ["late notes", data.lateNotes],
        ["worst late ms", data.worstLateMs],
      ]
    : [];

  return (
    <div
      className="fixed bottom-2 left-2 z-50 max-w-[260px] rounded border border-[#33475d] bg-[#1d3045]/95 p-3 font-mono text-[11px] leading-5 text-[#f5efe5] shadow-lg"
      data-testid="playback-diagnostics"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <strong>Playback diagnostics</strong>
        <button
          type="button"
          className="underline"
          onClick={() => {
            getEngine()?.resetDiagnostics();
            setData(getEngine()?.getDiagnostics() ?? null);
          }}
        >
          reset
        </button>
      </div>
      {rows.length === 0 ? (
        <p>Press play to start measuring.</p>
      ) : (
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="pr-3 opacity-70">{label}</td>
                <td>{value ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
