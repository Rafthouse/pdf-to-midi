import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { HighlightEvent } from '../types';
import { timbreById, REVERB_PRESETS, HUMANIZE, type ReverbMode } from '../lib/sound';

// SoundFont-based playback (real instrument samples, FluidSynth-class quality)
// running entirely in-app via WebAudio — no external synth/soundfont install.
//
// Audio is scheduled sample-accurately from the timeline (spessasynth supports
// a `time` on each event), with optional velocity/timing humanization and a
// legato note length. The visual highlight clock stays on the *pristine*
// timeline (no jitter), so audio feel and note highlighting never desync.

const SF_URL = 'soundfont.sf2';
const LOOKAHEAD = 0.12;   // seconds scheduled ahead
const TICK_MS = 25;
const CH = 0;             // single MIDI channel for playback

function randPm(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

export class SoundFontEngine {
  private ctx: AudioContext;
  private synth: WorkletSynthesizer | null = null;
  private synthBus: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private convolver: ConvolverNode;
  private master: GainNode;
  private irCache = new Map<number, AudioBuffer>();

  ready: Promise<void>;
  isReady = false;

  private timeline: HighlightEvent[] = [];
  private total = 0;

  private playing = false;
  private tempoFactor = 1;
  private baseStart = 0;     // timeline seconds at (re)start
  private ctxStart = 0;      // ctx.currentTime at (re)start
  private pausedBase = 0;
  private nextIndex = 0;
  private timer: number | null = null;

  private timbreId = 'piano';
  private reverbMode: ReverbMode = 'hall';
  private volume = 0.85;
  humanizeVelocity = true;
  humanizeTiming = true;

  loop = false;
  loopStart: number | null = null;  // base-timeline seconds; null = whole piece
  loopEnd: number | null = null;
  onEnd: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.synthBus = this.ctx.createGain();
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.convolver = this.ctx.createConvolver();

    this.synthBus.connect(this.dryGain).connect(this.master);
    this.synthBus.connect(this.convolver);
    this.convolver.connect(this.wetGain).connect(this.master);

    this.applyReverb();
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.ctx.audioWorklet.addModule(processorUrl);
    const sf = await (await fetch(SF_URL)).arrayBuffer();
    const synth = new WorkletSynthesizer(this.ctx);
    await synth.soundBankManager.addSoundBank(sf, 'main');
    await synth.isReady;
    synth.connect(this.synthBus);
    this.synth = synth;
    // Use only our external reverb; silence the synth's internal reverb/chorus.
    synth.controllerChange(CH, 91, 0);
    synth.controllerChange(CH, 93, 0);
    this.applyTimbre();
    this.isReady = true;
  }

  // --- reverb ------------------------------------------------------------- //
  private impulse(decay: number): AudioBuffer {
    const cached = this.irCache.get(decay);
    if (cached) return cached;
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * decay));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }
    this.irCache.set(decay, buf);
    return buf;
  }

  private applyReverb() {
    const p = REVERB_PRESETS[this.reverbMode];
    if (p.decay > 0) this.convolver.buffer = this.impulse(p.decay);
    this.wetGain.gain.value = p.wet;
    this.dryGain.gain.value = 1;
  }

  setReverb(mode: ReverbMode) {
    this.reverbMode = mode;
    this.applyReverb();
  }

  // --- timbre ------------------------------------------------------------- //
  private applyTimbre() {
    if (!this.synth) return;
    const t = timbreById(this.timbreId);
    this.synth.controllerChange(CH, 0, t.bank); // bank select MSB
    this.synth.programChange(CH, t.program);
  }

  setTimbre(id: string) {
    this.timbreId = id;
    this.applyTimbre();
  }

  // --- loading ------------------------------------------------------------ //
  load(timeline: HighlightEvent[], durationSec: number) {
    this.stop();
    this.timeline = [...timeline].sort((a, b) => a.onset_sec - b.onset_sec);
    this.total = durationSec || (this.timeline.at(-1)?.onset_sec ?? 0) + 2;
    this.pausedBase = 0;
  }

  get isPlaying() { return this.playing; }
  get duration() { return this.total; }

  /** Loop a measure range (seconds, base timeline). Null/null = whole piece.
   *  Boundaries are tempo-independent, so changing tempo never breaks the loop. */
  setLoopRange(start: number | null, end: number | null) {
    this.loopStart = start;
    this.loopEnd = end;
  }

  position(): number {
    if (!this.playing) return this.pausedBase;
    return this.baseStart + (this.ctx.currentTime - this.ctxStart) * this.tempoFactor;
  }

  activeAt(t: number): { midi: number[]; measure: number } {
    const midi = new Set<number>();
    let measure = 0;
    for (const c of this.timeline) {
      if (c.onset_sec > t) break;
      if (t < c.onset_sec + c.duration_sec) {
        c.midi.forEach((m) => midi.add(m));
        measure = c.measure;
      }
    }
    return { midi: [...midi], measure };
  }

  // --- transport ---------------------------------------------------------- //
  async play() {
    if (this.playing) return;
    // Resume synchronously within the user gesture (before any await) so the
    // browser autoplay policy lets the AudioContext start. Awaiting first would
    // defer resume() out of the gesture and leave the context suspended.
    const resuming = this.ctx.resume();
    await this.ready;
    await resuming;
    // When a selection is set, always start playback at its beginning if we're
    // outside the range (Play Selection / Loop behaviour).
    if (this.loopStart != null) {
      const end = this.loopEnd ?? this.total;
      if (this.pausedBase < this.loopStart || this.pausedBase >= end) {
        this.pausedBase = this.loopStart;
      }
    }
    this.playing = true;
    this.baseStart = this.pausedBase;
    this.ctxStart = this.ctx.currentTime + 0.06;
    this.nextIndex = this.timeline.findIndex((c) => c.onset_sec >= this.baseStart);
    if (this.nextIndex < 0) this.nextIndex = this.timeline.length;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  pause() {
    if (!this.playing) return;
    this.pausedBase = this.position();
    this.teardownTimer();
    this.playing = false;
    this.synth?.stopAll(false);
  }

  stop() {
    this.teardownTimer();
    this.playing = false;
    this.pausedBase = 0;
    this.synth?.stopAll(true);
  }

  seek(base: number) {
    const b = Math.max(0, Math.min(base, this.total));
    if (this.playing) {
      this.synth?.stopAll(true);
      this.baseStart = b;
      this.ctxStart = this.ctx.currentTime + 0.02;
      this.nextIndex = this.timeline.findIndex((c) => c.onset_sec >= b);
      if (this.nextIndex < 0) this.nextIndex = this.timeline.length;
    } else {
      this.pausedBase = b;
    }
  }

  setTempoPercent(percent: number) {
    const cur = this.position();
    this.tempoFactor = Math.max(0.25, Math.min(2.5, percent / 100));
    if (this.playing) {
      this.baseStart = cur;
      this.ctxStart = this.ctx.currentTime;
    }
  }

  setVolume(v01: number) {
    this.volume = Math.max(0, Math.min(1, v01));
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  dispose() {
    this.stop();
    this.synth?.destroy?.();
    this.ctx.close();
  }

  private teardownTimer() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  private tick() {
    if (!this.synth) return;
    const now = this.ctx.currentTime;
    const base = this.baseStart + (now - this.ctxStart) * this.tempoFactor;
    const horizon = base + LOOKAHEAD * this.tempoFactor;
    const end = this.loopEnd ?? this.total;

    while (this.nextIndex < this.timeline.length &&
           this.timeline[this.nextIndex].onset_sec <= horizon &&
           this.timeline[this.nextIndex].onset_sec < end) {  // never start notes past the loop end
      const cue = this.timeline[this.nextIndex];
      const whenBase = this.ctxStart + (cue.onset_sec - this.baseStart) / this.tempoFactor;
      const dur = Math.max(0.05, (cue.duration_sec / this.tempoFactor) * HUMANIZE.legato);
      for (const midi of cue.midi) {
        const vel = this.humanizeVelocity
          ? Math.max(20, Math.min(127, Math.round(HUMANIZE.velocityBase + randPm(HUMANIZE.velocityJitter))))
          : HUMANIZE.velocityBase;
        const jitter = this.humanizeTiming ? randPm(HUMANIZE.timingJitterMs) / 1000 : 0;
        const on = Math.max(now, whenBase + jitter);
        this.synth.noteOn(CH, midi, vel, { time: on });
        this.synth.noteOff(CH, midi, { time: on + dur });
      }
      this.nextIndex++;
    }

    if (base >= end) {
      if (this.loop) {
        // Seamless wrap: re-anchor the clock to the loop start WITHOUT cutting
        // sound. Already-scheduled tail notes (absolute times) ring out while
        // the loop's first notes start — no click, no gap.
        const ls = this.loopStart ?? 0;
        this.baseStart = ls;
        this.ctxStart = now;
        this.nextIndex = this.timeline.findIndex((c) => c.onset_sec >= ls);
        if (this.nextIndex < 0) this.nextIndex = this.timeline.length;
      } else if (this.loopEnd != null) {
        this.pause();  // Play Selection (no loop): stop at the selection end.
      } else if (base >= this.total) {
        this.pause(); this.pausedBase = 0; this.onEnd?.();
      }
    }
  }
}
