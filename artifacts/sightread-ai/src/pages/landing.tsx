import { ArrowRight, BookOpen, CirclePlay, FileMusic, Headphones, Music2, Sparkles, Upload } from 'lucide-react';
import { Link } from 'wouter';

const bars = [26, 42, 18, 34, 48, 22, 38, 30, 52, 24, 41, 18, 35, 46, 25, 37];

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand-home">
      <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#e46b50] text-[#fff8eb] shadow-[0_5px_12px_rgba(228,107,80,.22)]">
        <Music2 size={19} strokeWidth={2.2} />
      </span>
      <span className="font-serif text-[20px] font-semibold tracking-[-.03em] text-[#21354a]">SightRead <i className="not-italic text-[#db644a]">AI</i></span>
    </Link>
  );
}

export default function Landing() {
  return (
    <main className="paper-grain min-h-[100dvh] overflow-hidden bg-[#e9e3d8] text-[#21354a]">
      <nav className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-6 py-6 lg:px-10">
        <Wordmark />
        <div className="hidden items-center gap-8 text-[12px] font-semibold uppercase tracking-[.17em] text-[#526171] md:flex">
          <a href="#method" className="transition-colors hover:text-[#db644a]" data-testid="link-method">The method</a>
          <a href="#studio" className="transition-colors hover:text-[#db644a]" data-testid="link-studio">Inside the studio</a>
          <Link href="/reader" className="rounded-full border border-[#bcb3a5] px-5 py-2.5 transition-all hover:border-[#db644a] hover:bg-[#f1d5c9]" data-testid="link-open-reader">Open reader</Link>
        </div>
        <Link href="/reader" className="md:hidden" aria-label="Open reader" data-testid="link-open-reader-mobile"><ArrowRight size={21} /></Link>
      </nav>

      <section className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.05fr_.95fr] lg:px-10 lg:pb-32 lg:pt-20">
        <div className="relative z-[1]">
          <p className="rise-in mb-7 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.22em] text-[#db644a]"><span className="h-px w-8 bg-[#db644a]" /> A quiet place to practice</p>
          <h1 className="rise-in rise-in-delay-1 max-w-[680px] font-serif text-[clamp(3.6rem,7vw,7rem)] leading-[.91] tracking-[-.065em] text-[#21354a]">Meet the note<br /><span className="text-[#db644a]">halfway.</span></h1>
          <p className="rise-in rise-in-delay-2 mt-6 font-mono text-[11px] uppercase tracking-[.18em] text-[#214e4b]" data-testid="text-tagline">See it. Read it. Sing it. Play it.</p>
          <p className="rise-in rise-in-delay-2 mt-8 max-w-[490px] text-[17px] leading-7 text-[#526171]">SightRead AI turns unfamiliar pages into a score you can hear, follow, and trust — one measured phrase at a time.</p>
          <div className="rise-in rise-in-delay-3 mt-9 flex flex-wrap items-center gap-4">
            <Link href="/reader" className="group inline-flex items-center gap-3 rounded-full bg-[#db644a] px-6 py-3.5 text-[13px] font-bold uppercase tracking-[.13em] text-[#fff8eb] shadow-[0_10px_20px_rgba(180,71,50,.18)] transition-all hover:-translate-y-0.5 hover:bg-[#c85840]" data-testid="button-try-demo">
              Try the demo <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <a href="#method" className="inline-flex items-center gap-2 px-2 py-3 text-[13px] font-semibold text-[#526171] hover:text-[#db644a]" data-testid="link-see-method"><CirclePlay size={17} /> How it works</a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[520px] lg:ml-auto">
          <div className="absolute -right-4 -top-8 h-36 w-36 rounded-full border border-[#d2a69a] opacity-70" />
          <div className="absolute -bottom-7 -left-8 h-24 w-24 rounded-full bg-[#e7bd5f] opacity-70" />
          <div className="relative rotate-[2.2deg] rounded-[3px] border border-[#d5cbbd] bg-[#fbf7ee] px-7 py-8 shadow-[14px_20px_0_#d2c6b6,0_24px_40px_rgba(35,45,55,.16)] sm:px-12 sm:py-11">
            <div className="mb-8 flex items-start justify-between border-b border-[#dcd2c4] pb-4">
              <div><p className="font-serif text-[19px] text-[#21354a]">Evening Study</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[.2em] text-[#8c8379]">No. 04 · Andante</p></div>
              <span className="font-mono text-[10px] text-[#8c8379]">SRA / 04</span>
            </div>
            <div className="space-y-8 text-[#24384a]">
              <div className="relative h-[118px] border-y border-[#24384a] py-4">
                {[0, 1, 2, 3, 4].map((line) => <span key={line} className="absolute left-0 right-0 border-t border-[#536172]/70" style={{ top: `${25 + line * 15}px` }} />)}
                <span className="absolute left-5 top-3 font-serif text-[65px] leading-none">𝄞</span>
                <div className="absolute inset-x-[28%] top-[27px] flex items-end justify-between">
                  {[0, 1, 2, 3, 4].map((note) => <span key={note} className="relative block h-4 w-4 rotate-[-18deg] rounded-full bg-[#24384a] after:absolute after:bottom-2 after:left-[11px] after:h-12 after:w-[1px] after:bg-[#24384a]" style={{ transform: `translateY(${[13, 1, -11, 5, -7][note]}px) rotate(-18deg)` }} />)}
                </div>
              </div>
              <div className="relative h-[88px] border-b border-[#24384a]">
                {[0, 1, 2, 3, 4].map((line) => <span key={line} className="absolute left-0 right-0 border-t border-[#536172]/70" style={{ top: `${line * 13}px` }} />)}
                <span className="absolute left-5 top-[-3px] font-serif text-[51px] leading-none">𝄢</span>
                <div className="absolute left-[36%] right-[13%] top-[25px] flex justify-between"><span className="h-3 w-3 rounded-full bg-[#24384a]" /><span className="h-3 w-3 rounded-full bg-[#24384a]" /><span className="h-3 w-3 rounded-full bg-[#24384a]" /></div>
              </div>
            </div>
            <div className="mt-8 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.16em] text-[#8c8379]"><span>1 — 4</span><span>piano</span></div>
          </div>
          <div className="absolute -bottom-11 -right-3 flex items-center gap-3 rounded-full border border-[#d2c6b6] bg-[#f2ebdf] px-4 py-3 shadow-lg">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#214e4b] text-[#e9e3d8]"><Headphones size={13} /></span><span className="font-mono text-[10px] uppercase tracking-[.12em] text-[#526171]">Listen while you read</span>
          </div>
        </div>
      </section>

      <section id="method" className="border-y border-[#d2c7b9] bg-[#e3dcd0]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-6 py-16 lg:grid-cols-[.8fr_1.2fr] lg:px-10 lg:py-24">
          <div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#db644a]">01 / The method</p><h2 className="mt-5 max-w-[420px] font-serif text-[clamp(2.6rem,4vw,4.3rem)] leading-[.98] tracking-[-.055em]">Practice the part that asks for you.</h2></div>
          <div className="grid gap-9 sm:grid-cols-3">
            <div><span className="font-mono text-[11px] text-[#db644a]">01</span><BookOpen className="mt-5 text-[#214e4b]" size={25} strokeWidth={1.5} /><h3 className="mt-5 font-serif text-[22px]">See the shape</h3><p className="mt-2 text-[14px] leading-6 text-[#667070]">Import a score and get a clean, readable page. No scanning, no guessing.</p></div>
            <div><span className="font-mono text-[11px] text-[#db644a]">02</span><Headphones className="mt-5 text-[#214e4b]" size={25} strokeWidth={1.5} /><h3 className="mt-5 font-serif text-[22px]">Hear the path</h3><p className="mt-2 text-[14px] leading-6 text-[#667070]">Play the whole piece or sit with four measures until the contour settles.</p></div>
            <div><span className="font-mono text-[11px] text-[#db644a]">03</span><Sparkles className="mt-5 text-[#214e4b]" size={25} strokeWidth={1.5} /><h3 className="mt-5 font-serif text-[22px]">Play with intent</h3><p className="mt-2 text-[14px] leading-6 text-[#667070]">Slow the pulse down. Repeat the hard part. Let confidence arrive honestly.</p></div>
          </div>
        </div>
      </section>

      <section id="studio" className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 py-20 lg:grid-cols-[1fr_.85fr] lg:px-10 lg:py-28">
        <div className="order-2 lg:order-1">
          <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#db644a]">02 / The studio</p>
          <h2 className="mt-5 max-w-[530px] font-serif text-[clamp(2.6rem,4vw,4.2rem)] leading-[.98] tracking-[-.055em]">A score, not a spreadsheet.</h2>
          <p className="mt-6 max-w-[470px] text-[16px] leading-7 text-[#526171]">The tools stay close and the page stays clear. Everything in the reader is there to bring you back to the music.</p>
          <Link href="/reader" className="mt-8 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[.15em] text-[#db644a] hover:gap-3 transition-all" data-testid="link-enter-studio">Enter the studio <ArrowRight size={15} /></Link>
        </div>
        <div className="order-1 flex min-h-[250px] items-end justify-center gap-2 rounded-[2rem] bg-[#214e4b] px-8 py-14 lg:order-2">
          <div className="mr-5 self-center font-mono text-[10px] uppercase tracking-[.2em] text-[#b8d1c7] [writing-mode:vertical-rl]">A steady pulse</div>
          {bars.map((height, index) => <span key={index} className="music-bar w-[5px] rounded-full bg-[#e5bc62]" style={{ height: `${height}px`, animationDelay: `${index * .08}s` }} />)}
        </div>
      </section>

      <footer className="border-t border-[#d2c7b9] px-6 py-8 lg:px-10"><div className="mx-auto flex max-w-[1240px] flex-col gap-4 text-[11px] uppercase tracking-[.15em] text-[#7b7a72] sm:flex-row sm:items-center sm:justify-between"><Wordmark /><span>For the next page you haven't read yet.</span></div></footer>
    </main>
  );
}