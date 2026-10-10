import {
  clamp, engineVoiceParams, impactParams, rainNoiseParams, rollingNoiseParams, tireSquealParams, volumeToGain, windNoiseParams,
  type EngineSoundProfile, type EngineSoundState,
} from './audioModel.ts';
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from './audioSettings.ts';

/** État du véhicule nécessaire au son, à chaque image. */
export interface GameAudioFrame {
  rpm: number;
  idleRpm: number;
  maxRpm: number;
  throttle: number;
  gear: number;
  speedMps: number;
  /** Glissement normalisé de la télémétrie (1 = pic d'adhérence). */
  slip: number;
  groundedWheels: number;
  /** Part (0..1) des roues au sol qui roulent sur un sol meuble (gravier, herbe). */
  looseShare: number;
  /** Intensité de la pluie (0..1) et humidité de la piste (0..1). */
  rain: number;
  wetness: number;
}

/** Constante de temps (s) du lissage des paramètres : assez courte pour suivre le régime, assez longue pour éviter les « clics ». */
const PARAM_TIME_CONSTANT_S = 0.035;
const LEVEL_SAMPLE_EVERY_FRAMES = 6;
const SUSPEND_AFTER_FADE_MS = 160;
const NOISE_SECONDS = 2;

export interface GameAudioDebug {
  /** `AudioContext.state`, ou `unavailable` si le navigateur n'a pas Web Audio, ou `idle` avant le premier geste. */
  state: string;
  fundamentalHz: number;
  engineGain: number;
  squealGain: number;
  /** Niveau de sortie (dBFS, valeur efficace) : permet de vérifier qu'un son sort réellement. */
  levelDb: number;
}

/**
 * Synthèse sonore du jeu, entièrement générée (aucun fichier audio à charger ni à licencier). Graphe :
 *   moteur  : oscillateurs (fondamental, harmoniques, sous-harmonique) → écrêtage doux → passe-bas → gain (modulé) ┐
 *             bruit d'admission → passe-bande ───────────────────────────────────────────────────────────────────┤→ bus moteur
 *   effets  : crissement, roulement, vent (bruit filtré), chocs (bruit + « boum » grave) ─────────────────────────→ bus effets
 *   sortie  : bus → gain général → compresseur → analyseur → sortie.
 * Le contexte ne démarre qu'après un geste de l'utilisateur (politique de lecture automatique des navigateurs).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private settings: AudioSettings = DEFAULT_AUDIO_SETTINGS;
  private paused = false;
  private silent = true;
  private previousGear = 1;
  private lastShiftTimeS = -99;
  private frameCount = 0;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private gestureHooked = false;

  private master!: GainNode;
  private engineBus!: GainNode;
  private effectsBus!: GainNode;
  private analyser!: AnalyserNode;
  private levelBuffer!: Float32Array<ArrayBuffer>;
  private noiseBuffer!: AudioBuffer;

  private engineOscillators: OscillatorNode[] = [];
  private engineOscillatorGains: GainNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineVoiceGain!: GainNode;
  private roughnessOsc!: OscillatorNode;
  private roughnessDepth!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;

  private squealFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private squealTone!: OscillatorNode;
  private squealToneGain!: GainNode;
  private rollingFilter!: BiquadFilterNode;
  private rollingGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private rainGain!: GainNode;

  private lastDebug: GameAudioDebug = { state: 'idle', fundamentalHz: 0, engineGain: 0, squealGain: 0, levelDb: -120 };

  /** Le navigateur offre-t-il Web Audio ? (Absent en environnement de test Node.) */
  get supported(): boolean {
    return typeof window !== 'undefined' && (typeof window.AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
  }

  /**
   * À appeler dès le premier geste (clic, touche) : crée le contexte et le reprend s'il est suspendu. Idempotent. Les appels
   * hors geste n'ont aucun effet tant que le navigateur n'a pas reçu d'interaction.
   */
  ensureStarted(): void {
    if (!this.supported) return;
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume();
  }

  /** Branche un démarrage au tout premier geste de l'utilisateur sur la page, sans dépendre du bouton qu'il choisit. */
  unlockOnFirstGesture(): void {
    if (this.gestureHooked || typeof window === 'undefined') return;
    this.gestureHooked = true;
    const unlock = () => {
      this.ensureStarted();
      for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, unlock);
    };
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock);
  }

  setSettings(settings: AudioSettings): void {
    this.settings = settings;
    this.applyVolumes();
  }

  /** Active ou coupe le moteur et les effets de conduite (écran de conduite visible ou non). */
  setActive(active: boolean): void {
    this.silent = !active;
    if (!active) this.silenceVoices();
  }

  /**
   * Pause du jeu ou onglet masqué : fondu rapide vers le silence puis suspension du contexte (aucun calcul audio inutile) ;
   * à la reprise, le contexte repart et le volume remonte.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    if (paused) {
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      this.suspendTimer = setTimeout(() => { if (this.paused) void ctx.suspend(); }, SUSPEND_AFTER_FADE_MS);
    } else {
      void ctx.resume().then(() => this.applyVolumes());
    }
  }

  /** Mise à jour du moteur et des effets continus ; à appeler à chaque image de rendu. */
  update(frame: GameAudioFrame, profile: EngineSoundProfile): void {
    const ctx = this.ctx;
    if (!ctx || this.silent || this.paused || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (frame.gear !== this.previousGear) {
      // Un changement de rapport vers le haut ou le bas coupe brièvement le couple : le son plonge un instant.
      this.lastShiftTimeS = now;
      this.previousGear = frame.gear;
    }
    const state: EngineSoundState = {
      rpm: frame.rpm, idleRpm: frame.idleRpm, maxRpm: frame.maxRpm, load: frame.throttle, speedMps: frame.speedMps,
      secondsSinceShift: now - this.lastShiftTimeS, timeS: now,
    };
    const engine = engineVoiceParams(state, profile);
    const tc = PARAM_TIME_CONSTANT_S;

    this.engineOscillators.forEach((osc, index) => {
      const harmonic = [1, 2, 3, 4, 0.5][index];
      osc.frequency.setTargetAtTime(Math.max(5, engine.fundamentalHz * harmonic), now, tc);
      this.engineOscillatorGains[index].gain.setTargetAtTime(engine.oscillatorGains[index], now, tc);
    });
    this.engineFilter.frequency.setTargetAtTime(engine.filterHz, now, tc);
    this.engineVoiceGain.gain.setTargetAtTime(engine.gain, now, tc);
    this.intakeFilter.frequency.setTargetAtTime(engine.intakeHz, now, tc);
    this.intakeGain.gain.setTargetAtTime(engine.intakeGain, now, tc);
    this.roughnessOsc.frequency.setTargetAtTime(engine.roughnessHz, now, tc);
    this.roughnessDepth.gain.setTargetAtTime(engine.roughnessDepth * engine.gain, now, tc);

    const squeal = tireSquealParams(frame.slip, frame.speedMps);
    this.squealFilter.frequency.setTargetAtTime(squeal.hz * 1.6, now, tc);
    this.squealGain.gain.setTargetAtTime(squeal.gain, now, tc);
    this.squealTone.frequency.setTargetAtTime(squeal.hz, now, tc);
    this.squealToneGain.gain.setTargetAtTime(squeal.gain * 0.35, now, tc);
    const rolling = rollingNoiseParams(frame.speedMps, frame.groundedWheels, frame.looseShare, frame.wetness);
    this.rollingFilter.frequency.setTargetAtTime(rolling.hz, now, tc);
    this.rollingGain.gain.setTargetAtTime(rolling.gain, now, tc);
    const rain = rainNoiseParams(frame.rain);
    this.rainFilter.frequency.setTargetAtTime(rain.hz, now, 0.3);
    this.rainGain.gain.setTargetAtTime(rain.gain, now, 0.3);
    const wind = windNoiseParams(frame.speedMps);
    this.windFilter.frequency.setTargetAtTime(wind.hz, now, tc);
    this.windGain.gain.setTargetAtTime(wind.gain, now, tc);

    this.lastDebug.fundamentalHz = engine.fundamentalHz;
    this.lastDebug.engineGain = engine.gain;
    this.lastDebug.squealGain = squeal.gain;
    this.frameCount += 1;
    if (this.frameCount % LEVEL_SAMPLE_EVERY_FRAMES === 0) this.sampleLevel();
  }

  /** Choc : un « boum » grave et un claquement de bruit, plus fort et plus long avec l'intensité (0 à 1). */
  impact(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || this.silent || this.paused || ctx.state !== 'running' || intensity <= 0) return;
    const p = impactParams(intensity);
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(5_000, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, now + p.durationS);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(p.gain * p.noiseGain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + p.durationS);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.effectsBus);
    noise.start(now, Math.random() * (NOISE_SECONDS - 1));
    noise.stop(now + p.durationS + 0.05);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(p.thumpHz, now);
    thump.frequency.exponentialRampToValueAtTime(30, now + p.durationS * 1.4);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(p.gain * 0.9, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + p.durationS * 1.4);
    thump.connect(thumpGain).connect(this.effectsBus);
    thump.start(now);
    thump.stop(now + p.durationS * 1.4 + 0.05);
  }

  debug(): GameAudioDebug {
    return { ...this.lastDebug, state: this.ctx ? this.ctx.state : this.supported ? 'idle' : 'unavailable' };
  }

  // -------------------------------------------------------------------------------------------------------------

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const { master, engine, effects, muted } = this.settings;
    this.master.gain.setTargetAtTime(muted || this.paused ? 0 : volumeToGain(master), now, 0.04);
    this.engineBus.gain.setTargetAtTime(volumeToGain(engine), now, 0.04);
    this.effectsBus.gain.setTargetAtTime(volumeToGain(effects), now, 0.04);
  }

  private silenceVoices(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const gain of [this.engineVoiceGain, this.intakeGain, this.squealGain, this.squealToneGain, this.rollingGain, this.windGain, this.rainGain]) {
      gain.gain.setTargetAtTime(0, now, 0.04);
    }
    this.lastDebug.engineGain = 0;
    this.lastDebug.squealGain = 0;
  }

  private sampleLevel(): void {
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) sum += this.levelBuffer[i] * this.levelBuffer[i];
    const rms = Math.sqrt(sum / this.levelBuffer.length);
    this.lastDebug.levelDb = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }

  private noiseSource(): AudioBufferSourceNode {
    const source = this.ctx!.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  private build(): void {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Sortie : bus → général → compresseur (évite de saturer quand tout joue ensemble) → analyseur → haut-parleurs.
    this.master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.levelBuffer = new Float32Array(this.analyser.fftSize);
    this.master.connect(compressor).connect(this.analyser).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.effectsBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.effectsBus.connect(this.master);

    // Bruit blanc de 2 s, partagé par tous les bruits filtrés (aucune dépendance à un fichier audio).
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const samples = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;

    // Moteur.
    const waveforms: OscillatorType[] = ['sawtooth', 'square', 'sawtooth', 'sawtooth', 'triangle'];
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2);
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.9;
    this.engineVoiceGain = ctx.createGain();
    this.engineVoiceGain.gain.value = 0;
    waveforms.forEach((type) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(shaper);
      osc.start();
      this.engineOscillators.push(osc);
      this.engineOscillatorGains.push(gain);
    });
    shaper.connect(this.engineFilter).connect(this.engineVoiceGain).connect(this.engineBus);
    // Irrégularité de cycle : un oscillateur lent module le gain de la voix (somme avec sa valeur de base).
    this.roughnessOsc = ctx.createOscillator();
    this.roughnessOsc.frequency.value = 8;
    this.roughnessDepth = ctx.createGain();
    this.roughnessDepth.gain.value = 0;
    this.roughnessOsc.connect(this.roughnessDepth).connect(this.engineVoiceGain.gain);
    this.roughnessOsc.start();
    // Bruit d'admission.
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    const intake = this.noiseSource();
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.engineBus);
    intake.start();

    // Effets continus.
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.Q.value = 7;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const squealNoise = this.noiseSource();
    squealNoise.connect(this.squealFilter).connect(this.squealGain).connect(this.effectsBus);
    squealNoise.start();
    // Partie tonale du crissement : un sifflement qui oscille légèrement, comme la gomme qui « chante ».
    this.squealTone = ctx.createOscillator();
    this.squealTone.type = 'triangle';
    this.squealToneGain = ctx.createGain();
    this.squealToneGain.gain.value = 0;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 35;
    wobble.connect(wobbleDepth).connect(this.squealTone.frequency);
    wobble.start();
    this.squealTone.connect(this.squealToneGain).connect(this.effectsBus);
    this.squealTone.start();

    this.rollingFilter = ctx.createBiquadFilter();
    this.rollingFilter.type = 'lowpass';
    this.rollingFilter.Q.value = 0.6;
    this.rollingGain = ctx.createGain();
    this.rollingGain.gain.value = 0;
    const rolling = this.noiseSource();
    rolling.connect(this.rollingFilter).connect(this.rollingGain).connect(this.effectsBus);
    rolling.start();

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const wind = this.noiseSource();
    wind.connect(this.windFilter).connect(this.windGain).connect(this.effectsBus);
    wind.start();

    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.Q.value = 0.4;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainSource = this.noiseSource();
    rainSource.connect(this.rainFilter).connect(this.rainGain).connect(this.effectsBus);
    rainSource.start();

    this.applyVolumes();
    // Le contexte démarre souvent « suspended » : on le reprend dès que possible (le geste a eu lieu si on est ici).
    if (ctx.state === 'suspended' && !this.paused) void ctx.resume();
  }
}

/** Instance unique : un seul contexte audio par page (les navigateurs en limitent le nombre). */
let instance: GameAudio | null = null;
export function getGameAudio(): GameAudio {
  instance ??= new GameAudio();
  return instance;
}

/** Volume « utile » d'un niveau pour l'interface : arrondi à l'unité de dB, 0 si silence. */
export const formatLevelDb = (db: number) => (db <= -100 ? '−∞' : `${clamp(Math.round(db), -99, 0)} dB`);
