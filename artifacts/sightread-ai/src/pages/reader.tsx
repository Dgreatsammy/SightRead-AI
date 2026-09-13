import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  FileUp,
  Gauge,
  Music2,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Link } from 'wouter';
import { demoMusicXml, isMusicXml } from '@/lib/musicxml';
import {
  CountInBars,
  MusicalPlaybackEngine,
  parseMusicXml,
  type PlaybackScore,
  type PlaybackSnapshot,
  type PlaybackState,
} from '@/lib/playback';

type PracticeSettings = {
  tempo: number;
  speed: number;
  metronome: boolean;
  volume: number;
  rangeStart: number;
  rangeEnd: number;
};

const PRACTICE_SETTINGS_KEY = 'sightread-ai.practice-settings';
const DEFAULT_SETTINGS: PracticeSettings = {
  tempo: 76,
  speed: 1,
  metronome: false,
  volume: 0.65,
  rangeStart: 1,
  rangeEnd: 4,
};

function readPracticeSettings(): PracticeSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(PRACTICE_SETTINGS_KEY) ?? '{}') as Partial<PracticeSettings>;
    return {
      tempo: Number.isFinite(stored.tempo) ? Math.max(40, Math.min(160, stored.tempo!)) : DEFAULT_SETTINGS.tempo,
      speed: stored.speed === 0.25 || stored.speed === 0.5 || stored.speed === 0.75 || stored.speed === 1 ? stored.speed : DEFAULT_SETTINGS.speed,
      metronome: stored.metronome === true,
      volume: Number.isFinite(stored.volume) ? Math.max(0, Math.min(1, stored.volume!)) : DEFAULT_SETTINGS.volume,
      rangeStart: Number.isFinite(stored.rangeStart) ? Math.max(1, Math.floor(stored.rangeStart!)) : DEFAULT_SETTINGS.rangeStart,
      rangeEnd: Number.isFinite(stored.rangeEnd) ? Math.max(1, Math.floor(stored.rangeEnd!)) : DEFAULT_SETTINGS.rangeEnd,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const initialSettings = readPracticeSettings();

function formatMidi(midi: number | null) {
  if (midi === null) return '—';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-reader-brand">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#e46b50] text-[#fff8eb]">
        <Music2 size={17} />
      </span>
      <span className="hidden font-serif text-[18px] font-semibold tracking-[-.03em] text-[#f5efe5] sm:block">
        SightRead <i className="not-italic text-[#ef8b70]">AI</i>
      </span>
    </Link>
  );
}

function PlaybackIcon({ state }: { state: PlaybackState }) {
  if (state === 'playing' || state === 'counting-in') return <Pause size={17} fill="currentColor" />;
  return <Play size={17} fill="currentColor" />;
}

export default function Reader() {
  const scoreRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<MusicalPlaybackEngine | null>(null);
  const rangeRef = useRef({ start: initialSettings.rangeStart, end: initialSettings.rangeEnd });
  const settingsRef = useRef(initialSettings);
  const [xml, setXml] = useState(demoMusicXml);
  const [scoreTitle, setScoreTitle] = useState('Evening Study');
  const [scoreStatus, setScoreStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const [tempo, setTempo] = useState(initialSettings.tempo);
  const [speed, setSpeed] = useState(initialSettings.speed);
  const [countInBars, setCountInBars] = useState<CountInBars>(0);
  const [metronome, setMetronome] = useState(initialSettings.metronome);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [muted, setMuted] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>('stopped');
  const [currentMeasure, setCurrentMeasure] = useState(1);
  const [currentNoteMidi, setCurrentNoteMidi] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [countInBeatsTotal, setCountInBeatsTotal] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const [score, setScore] = useState<PlaybackScore | null>(null);
  const [loop, setLoop] = useState(false);
  const [loopStart, setLoopStart] = useState(initialSettings.rangeStart);
  const [loopEnd, setLoopEnd] = useState(initialSettings.rangeEnd);

  settingsRef.current = { tempo, speed, metronome, volume, rangeStart: loopStart, rangeEnd: loopEnd };
  rangeRef.current = { start: loopStart, end: loopEnd };

  const handleProgress = useCallback((snapshot: PlaybackSnapshot) => {
    setPlayback(snapshot.state);
    setCurrentMeasure(snapshot.currentMeasure + 1);
    setCurrentNoteMidi(snapshot.currentNoteMidi);
    setProgress(snapshot.progress);
    setCountInBeat(snapshot.countInBeat);
    setCountInBeatsTotal(snapshot.countInBeatsTotal);
    setLoopCount(snapshot.loopCount);
  }, []);

  useEffect(() => {
    const engine = new MusicalPlaybackEngine(handleProgress);
    engineRef.current = engine;
    engine.setTempo(initialSettings.tempo);
    engine.setPlaybackSpeed(initialSettings.speed);
    engine.setMetronome(initialSettings.metronome);
    engine.setVolume(initialSettings.volume);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [handleProgress]);

  useEffect(() => {
    if (!score) return;
    const engine = engineRef.current;
    engine?.setScore(score);
    engine?.setTempo(settingsRef.current.tempo);
    engine?.setPlaybackSpeed(settingsRef.current.speed);
    engine?.setMetronome(settingsRef.current.metronome);
    engine?.setVolume(settingsRef.current.volume);
    engine?.setMuted(muted);
    engine?.setRange(loopStart - 1, loopEnd - 1);
    engine?.setLoop(loop);
  }, [score]);

  useEffect(() => {
    if (!score) return;
    engineRef.current?.setRange(loopStart - 1, loopEnd - 1);
  }, [score, loopStart, loopEnd]);

  useEffect(() => {
    engineRef.current?.setTempo(tempo);
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settingsRef.current));
  }, [tempo]);

  useEffect(() => {
    engineRef.current?.setPlaybackSpeed(speed);
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settingsRef.current));
  }, [speed]);

  useEffect(() => {
    engineRef.current?.setMetronome(metronome);
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settingsRef.current));
  }, [metronome]);

  useEffect(() => {
    engineRef.current?.setCountInBars(countInBars);
  }, [countInBars]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settingsRef.current));
  }, [volume]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    window.localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify(settingsRef.current));
  }, [loopStart, loopEnd]);

  const renderScore = useCallback(async (source: string) => {
    if (!scoreRef.current) return;
    engineRef.current?.stop();
    setScoreStatus('loading');
    setErrorText('');
    scoreRef.current.innerHTML = '';
    try {
      const parsed = parseMusicXml(source);
      const nextStart = Math.min(parsed.measures.length, Math.max(1, rangeRef.current.start));
      const nextEnd = Math.min(parsed.measures.length, Math.max(nextStart, rangeRef.current.end));
      setScore(parsed);
      setScoreTitle(parsed.title);
      setLoopStart(nextStart);
      setLoopEnd(nextEnd);
      setCurrentMeasure(nextStart);
      setProgress(0);
      setCurrentNoteMidi(null);
      const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
      const osmd = new OpenSheetMusicDisplay(scoreRef.current, {
        autoResize: true,
        backend: 'svg',
        drawTitle: true,
        drawSubtitle: true,
        drawComposer: true,
        pageFormat: 'Endless',
        darkMode: false,
        followCursor: true,
      });
      await osmd.load(source);
      osmd.render();
      setScoreStatus('ready');
    } catch (error) {
      setScoreStatus('error');
      setScore(null);
      setErrorText(
        error instanceof Error
          ? error.message
          : 'That file could not be read as MusicXML. Try exporting a .musicxml or .xml file from your notation app.',
      );
    }
  }, []);

  useEffect(() => {
    void renderScore(xml);
  }, [renderScore, xml]);

  const togglePlayback = () => {
    if (playback === 'playing' || playback === 'counting-in') engineRef.current?.pause();
    else engineRef.current?.play();
  };

  const stopPlayback = () => engineRef.current?.stop();

  const jumpMeasure = (measure: number) => {
    const measureCount = score?.measures.length ?? 1;
    const next = Math.min(measureCount, Math.max(1, measure));
    engineRef.current?.seekMeasure(next - 1);
    setCurrentMeasure(next);
    setCurrentNoteMidi(null);
    scoreRef.current?.scrollTo({ left: (next - 1) * 260, behavior: 'smooth' });
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (!isMusicXml(content)) {
        setScoreStatus('error');
        setErrorText('This file is not MusicXML. Choose a .musicxml or .xml score to continue.');
        return;
      }
      setScoreTitle(file.name.replace(/\.(musicxml|xml)$/i, '') || 'Imported score');
      setXml(content);
      setCurrentMeasure(1);
      setProgress(0);
    };
    reader.onerror = () => {
      setScoreStatus('error');
      setErrorText('We could not open that file. Please try it again.');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const measureCount = score?.measures.length ?? 0;
  const updateRange = (start: number, end: number) => {
    const safeStart = Math.max(1, Math.min(start, measureCount || 1));
    const safeEnd = Math.max(safeStart, Math.min(end, measureCount || safeStart));
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
    engineRef.current?.setRange(safeStart - 1, safeEnd - 1);
    setProgress(0);
    setCurrentMeasure(safeStart);
  };

  const playbackLabel =
    playback === 'counting-in'
      ? `Count-in ${countInBeat}/${countInBeatsTotal}`
      : playback === 'playing'
        ? 'Playing'
        : playback === 'paused'
          ? 'Paused'
          : 'Ready';

  return (
    <main className="paper-grain min-h-[100dvh] bg-[#e9e3d8] text-[#21354a]">
      <header className="flex min-h-[68px] items-center justify-between border-b border-[#33475d] bg-[#1d3045] px-5 text-[#f5efe5] lg:px-8">
        <div className="flex items-center gap-5">
          <Link href="/" className="text-[#b8c3c5] transition-colors hover:text-[#f5efe5]" aria-label="Back to home" data-testid="link-back-home">
            <ArrowLeft size={18} />
          </Link>
          <BrandMark />
          <span className="hidden h-5 w-px bg-[#526276] sm:block" />
          <div className="hidden font-mono text-[10px] uppercase tracking-[.16em] text-[#9ba8ae] sm:block">Practice room / reader</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-[#627286] px-3 py-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#e9e3d8] transition-colors hover:border-[#ef8b70] hover:text-[#ef8b70]"
            data-testid="button-import-musicxml"
          >
            <FileUp size={15} /> <span className="hidden sm:inline">Import MusicXML</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xml,.musicxml,application/xml,text/xml" className="hidden" onChange={handleImport} data-testid="input-musicxml-file" />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="min-w-0 px-4 pb-10 pt-7 sm:px-7 lg:px-10 lg:pt-10">
          <div className="mx-auto max-w-[1040px]">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[.19em] text-[#db644a]">Current score</p>
                <h1 className="mt-2 font-serif text-[clamp(2rem,4vw,3.35rem)] leading-none tracking-[-.055em]" data-testid="text-score-title">
                  {scoreTitle}
                </h1>
                <p className="mt-3 text-[13px] text-[#69737a]">Piano · {measureCount || '—'} measures · a study in finding the line</p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-[#cec3b5] bg-[#f2ece2] px-3 py-2 font-mono text-[10px] uppercase tracking-[.13em] text-[#6f7776]" data-testid="status-score">
                <span className={`h-2 w-2 rounded-full ${scoreStatus === 'ready' ? 'bg-[#4c8d73]' : scoreStatus === 'error' ? 'bg-[#db644a]' : 'bg-[#d9a744]'}`} />
                {scoreStatus === 'ready' ? 'Score ready' : scoreStatus === 'error' ? 'Needs attention' : 'Setting the page'}
              </div>
            </div>

            <div className="score-shell relative overflow-hidden rounded-[4px] border border-[#d4c8b9] bg-[#fcf8ef]">
              {scoreStatus === 'loading' && (
                <div className="absolute inset-0 z-[2] flex min-h-[560px] flex-col items-center justify-center bg-[#fcf8ef] px-6">
                  <div className="mb-5 flex items-end gap-1.5" aria-hidden="true">
                    <span className="h-5 w-1.5 animate-pulse rounded-full bg-[#db644a]" />
                    <span className="h-8 w-1.5 animate-pulse rounded-full bg-[#e2bc64] [animation-delay:120ms]" />
                    <span className="h-6 w-1.5 animate-pulse rounded-full bg-[#214e4b] [animation-delay:240ms]" />
                  </div>
                  <p className="font-serif text-[21px]">Setting the page…</p>
                  <p className="mt-2 text-[13px] text-[#7a817f]">Rendering your score for reading.</p>
                </div>
              )}
              {scoreStatus === 'error' && (
                <div className="flex min-h-[560px] flex-col items-center justify-center px-6 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-[#f2d2c6] text-[#c85840]"><FileUp size={20} /></div>
                  <p className="mt-5 font-serif text-[23px]">This page needs another score.</p>
                  <p className="mt-2 max-w-[390px] text-[13px] leading-6 text-[#727875]" data-testid="status-score-error">{errorText}</p>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-6 rounded-full bg-[#db644a] px-5 py-3 text-[11px] font-bold uppercase tracking-[.13em] text-[#fff8eb] transition-colors hover:bg-[#c85840]" data-testid="button-retry-import">
                    Choose another file
                  </button>
                </div>
              )}
              <div ref={scoreRef} className={`score-viewer max-h-[650px] min-h-[560px] overflow-auto p-5 transition-opacity sm:p-9 ${scoreStatus === 'ready' ? 'opacity-100' : 'opacity-0'}`} data-testid="score-rendered" aria-label="Rendered MusicXML score" />
              {scoreStatus === 'ready' && (
                <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
                  <div className="rounded-full bg-[#214e4b] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-[#e8eee7] opacity-90" data-testid="status-current-measure">
                    Reading measure {currentMeasure}
                  </div>
                  {playback === 'counting-in' && (
                    <div className="rounded-full bg-[#c58c59] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-[#fff8eb]" data-testid="status-count-in">
                      Count-in {countInBeat} / {countInBeatsTotal}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[.13em] text-[#87908d]">
              <span>Digital score / MusicXML</span>
              <span data-testid="text-score-position">Measure {currentMeasure} of {measureCount || '—'}</span>
            </div>
          </div>
        </section>

        <aside className="border-t border-[#d0c4b6] bg-[#e2dbcf] lg:min-h-[calc(100dvh-68px)] lg:border-l lg:border-t-0">
          <div className="sticky top-0 px-5 pb-8 pt-7 sm:px-7 lg:px-8 lg:pt-10">
            <div className="mb-8">
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#db644a]">Practice controls</p>
              <h2 className="mt-2 font-serif text-[27px] tracking-[-.04em]">Make it yours.</h2>
            </div>

            <div className="rounded-[4px] border border-[#cfc2b3] bg-[#f3ece1] p-4 shadow-[0_8px_18px_rgba(31,42,53,.05)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]">Playback</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#db644a]" data-testid="status-playback">
                  <span className={`h-1.5 w-1.5 rounded-full ${playback === 'playing' || playback === 'counting-in' ? 'animate-pulse bg-[#db644a]' : 'bg-[#aab1ac]'}`} />
                  {playbackLabel}
                </span>
              </div>
              <div className="mt-5 flex items-center gap-2">
                <button type="button" onClick={togglePlayback} disabled={scoreStatus !== 'ready'} className="grid h-12 w-12 place-items-center rounded-full bg-[#db644a] text-[#fff8eb] shadow-[0_7px_14px_rgba(190,75,54,.2)] transition-all hover:-translate-y-0.5 hover:bg-[#c85840] disabled:cursor-not-allowed disabled:opacity-40" aria-label={playback === 'playing' || playback === 'counting-in' ? 'Pause score' : 'Play score'} data-testid="button-play-pause">
                  <PlaybackIcon state={playback} />
                </button>
                <button type="button" onClick={stopPlayback} className="grid h-10 w-10 place-items-center rounded-full border border-[#c5b8aa] text-[#526171] transition-colors hover:border-[#db644a] hover:text-[#db644a]" aria-label="Stop score" data-testid="button-stop">
                  <Square size={14} fill="currentColor" />
                </button>
                <button type="button" onClick={() => engineRef.current?.reset()} className="ml-auto grid h-10 w-10 place-items-center rounded-full border border-[#c5b8aa] text-[#526171] transition-colors hover:border-[#db644a] hover:text-[#db644a]" aria-label="Reset to beginning" data-testid="button-reset">
                  <RotateCcw size={15} />
                </button>
              </div>

              <div className="mt-5 border-t border-[#d9cebf] pt-5">
                <div className="flex items-center justify-between">
                  <label htmlFor="tempo" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]"><Gauge size={14} /> Tempo</label>
                  <span className="font-mono text-[12px] text-[#21354a]" data-testid="text-tempo">{tempo} BPM</span>
                </div>
                <input id="tempo" type="range" min="40" max="160" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} className="mt-4 h-1.5 w-full accent-[#db644a]" data-testid="input-tempo" aria-label="Tempo in beats per minute" />
                <div className="mt-2 flex justify-between font-mono text-[9px] text-[#9a9c94]"><span>40</span><span>160</span></div>
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#d8cec1]" role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} data-testid="progress-playback">
                  <div className="h-full rounded-full bg-[#db644a] transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.12em] text-[#9a9c94]">
                  <span data-testid="text-playback-measure">Measure {currentMeasure}</span>
                  <span data-testid="text-playback-note">Note {formatMidi(currentNoteMidi)}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-[4px] border border-[#cfc2b3] bg-[#f3ece1] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]">Practice speed</span>
                <span className="font-mono text-[11px] text-[#db644a]">{Math.round(speed * 100)}%</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-1.5" role="group" aria-label="Practice speed">
                {[0.25, 0.5, 0.75, 1].map((option) => (
                  <button key={option} type="button" onClick={() => setSpeed(option)} aria-pressed={speed === option} className={`rounded-[3px] border py-2 font-mono text-[10px] transition-colors ${speed === option ? 'border-[#db644a] bg-[#db644a] text-[#fff8eb]' : 'border-[#d0c3b5] bg-[#ede4d8] text-[#667070] hover:border-[#db644a]'}`} data-testid={`button-speed-${Math.round(option * 100)}`}>
                    {Math.round(option * 100)}%
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#7b7d76]">Slows the actual notes and metronome together.</p>
            </div>

            <div className="mt-4 rounded-[4px] border border-[#cfc2b3] bg-[#f3ece1] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]">Count-in</span>
                <span className="font-mono text-[11px] text-[#db644a]">{countInBars === 0 ? 'Off' : `${countInBars} bar${countInBars > 1 ? 's' : ''}`}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-1.5" role="group" aria-label="Count-in length">
                {([0, 1, 2] as CountInBars[]).map((option) => (
                  <button key={option} type="button" onClick={() => setCountInBars(option)} aria-pressed={countInBars === option} className={`rounded-[3px] border py-2 font-mono text-[10px] transition-colors ${countInBars === option ? 'border-[#214e4b] bg-[#214e4b] text-[#fff8eb]' : 'border-[#d0c3b5] bg-[#ede4d8] text-[#667070] hover:border-[#214e4b]'}`} data-testid={`button-count-in-${option}`}>
                    {option === 0 ? 'Off' : `${option} bar`}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#7b7d76]">Audible counts happen before the selected range.</p>
            </div>

            <div className="mt-4 rounded-[4px] border border-[#cfc2b3] bg-[#f3ece1] p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]">Sound</span>
                <button type="button" onClick={() => setMetronome((value) => !value)} aria-pressed={metronome} className={`rounded-full px-3 py-1 font-mono text-[9px] uppercase tracking-[.12em] transition-colors ${metronome ? 'bg-[#214e4b] text-[#fff8eb]' : 'bg-[#ded5c9] text-[#707a79]'}`} data-testid="button-toggle-metronome">
                  Metronome {metronome ? 'on' : 'off'}
                </button>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <button type="button" onClick={() => setMuted((value) => !value)} aria-pressed={muted} aria-label={muted ? 'Unmute audio' : 'Mute audio'} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#c5b8aa] text-[#526171] transition-colors hover:border-[#db644a] hover:text-[#db644a]" data-testid="button-toggle-mute">
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="volume" className="font-mono text-[10px] uppercase tracking-[.13em] text-[#707a79]">Master volume</label>
                    <span className="font-mono text-[10px] text-[#707a79]">{Math.round(volume * 100)}%</span>
                  </div>
                  <input id="volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="mt-3 h-1.5 w-full accent-[#db644a]" aria-label="Master volume" data-testid="input-volume" />
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-[#7b7d76]">Notes and metronome share one safe master level.</p>
            </div>

            <div className="mt-4 rounded-[4px] border border-[#cfc2b3] bg-[#f3ece1] p-4">
              <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]">Jump to measure</span><span className="font-mono text-[11px] text-[#db644a]">{String(currentMeasure).padStart(2, '0')}</span></div>
              <div className="mt-4 grid grid-cols-4 gap-1.5">{Array.from({ length: measureCount }, (_, index) => index + 1).map((measure) => <button key={measure} type="button" onClick={() => jumpMeasure(measure)} className={`h-9 rounded-[3px] border font-mono text-[11px] transition-colors ${currentMeasure === measure ? 'border-[#db644a] bg-[#db644a] text-[#fff8eb]' : 'border-[#d0c3b5] bg-[#ede4d8] text-[#667070] hover:border-[#db644a] hover:text-[#db644a]'}`} aria-label={`Go to measure ${measure}`} data-testid={`button-measure-${measure}`}>{measure}</button>)}</div>
            </div>

            <div className={`mt-4 rounded-[4px] border p-4 transition-colors ${loop ? 'border-[#c58c59] bg-[#f5e6cb]' : 'border-[#cfc2b3] bg-[#f3ece1]'}`}>
              <button type="button" onClick={() => { setLoop((value) => { engineRef.current?.setLoop(!value); return !value; }); }} className="flex w-full items-center justify-between" aria-pressed={loop} data-testid="button-toggle-loop">
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[#707a79]"><Repeat2 size={14} /> Loop passage</span>
                <span className={`relative h-5 w-9 rounded-full transition-colors ${loop ? 'bg-[#db644a]' : 'bg-[#c7bdb0]'}`}><span className={`absolute top-1 h-3 w-3 rounded-full bg-[#fff8eb] transition-transform ${loop ? 'translate-x-5' : 'translate-x-1'}`} /></span>
              </button>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <label className="font-mono text-[9px] uppercase tracking-[.12em] text-[#8a8d86]">Start<input type="number" min="1" max={loopEnd} value={loopStart} onChange={(event) => updateRange(Number(event.target.value) || 1, loopEnd)} className="mt-2 w-full rounded-[3px] border border-[#cfc2b3] bg-[#f9f3e9] px-3 py-2 font-sans text-[13px] text-[#21354a] outline-none focus:border-[#db644a]" data-testid="input-loop-start" /></label>
                <label className="font-mono text-[9px] uppercase tracking-[.12em] text-[#8a8d86]">End<input type="number" min={loopStart} max={Math.max(loopStart, measureCount)} value={loopEnd} onChange={(event) => updateRange(loopStart, Number(event.target.value) || measureCount)} className="mt-2 w-full rounded-[3px] border border-[#cfc2b3] bg-[#f9f3e9] px-3 py-2 font-sans text-[13px] text-[#21354a] outline-none focus:border-[#db644a]" data-testid="input-loop-end" /></label>
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[.12em] text-[#7b7d76]"><span>{loop ? `Active: ${loopStart}–${loopEnd}` : `Range: ${loopStart}–${loopEnd}`}</span><span data-testid="text-loop-count">Loops {loopCount}</span></div>
              <p className="mt-3 text-[11px] leading-5 text-[#7b7d76]">{loop ? `Measures ${loopStart}–${loopEnd} will repeat while you play.` : 'Turn this on to stay with a difficult passage.'}</p>
            </div>

            <div className="mt-8 border-t border-[#cfc2b3] pt-6">
              <p className="font-mono text-[10px] uppercase tracking-[.17em] text-[#8a8d86]">Reader notes</p>
              <p className="mt-3 text-[13px] leading-6 text-[#69716f]">The coral marker follows your place. Slow the tempo until the shape of the phrase feels obvious.</p>
              <div className="mt-5 flex items-center gap-2 text-[#214e4b]"><Volume2 size={15} /><span className="font-mono text-[10px] uppercase tracking-[.12em]">Sound is local to this browser</span></div>
            </div>
          </div>
        </aside>
      </div>
      <div className="flex justify-center border-t border-[#d1c5b6] py-5"><Link href="/" className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[#7d827d] hover:text-[#db644a]" data-testid="link-reader-home"><ChevronLeft size={14} /> Back to SightRead AI</Link></div>
    </main>
  );
}