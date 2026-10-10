/**
 * Bassin de particules à capacité fixe (fumée, étincelles). Tableaux typés préalloués : aucune allocation par particule ni
 * par image, et une particule en trop écrase la plus ancienne (tampon circulaire). Logique pure, sans three.js.
 */

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Durée de vie (s). */
  life: number;
  /** Taille (m) à la naissance et à la fin de vie : la fumée grossit, les étincelles rétrécissent. */
  sizeStart: number;
  sizeEnd: number;
  /** Opacité maximale, atteinte après la montée initiale. */
  alpha: number;
}

export interface ParticlePhysics {
  /** Accélération verticale (m/s²) : négative pour des étincelles, légèrement positive pour une fumée chaude qui monte. */
  gravityY: number;
  /** Frottement de l'air (1/s) : la vitesse décroît en exp(-drag·t). */
  drag: number;
  /** Fraction de la vie passée à apparaître en fondu (évite les « pops » visibles). */
  fadeIn: number;
}

export class ParticlePool {
  readonly capacity: number;
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private readonly sizeStarts: Float32Array;
  private readonly sizeEnds: Float32Array;
  private readonly peakAlphas: Float32Array;
  private next = 0;
  private live = 0;

  constructor(capacity: number, private readonly physics: ParticlePhysics) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.ages = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);
    this.sizeStarts = new Float32Array(capacity);
    this.sizeEnds = new Float32Array(capacity);
    this.peakAlphas = new Float32Array(capacity);
    this.lives.fill(0);
  }

  /** Nombre de particules vivantes. */
  get active(): number {
    return this.live;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.positions[i * 3] = p.x; this.positions[i * 3 + 1] = p.y; this.positions[i * 3 + 2] = p.z;
    this.velocities[i * 3] = p.vx; this.velocities[i * 3 + 1] = p.vy; this.velocities[i * 3 + 2] = p.vz;
    this.ages[i] = 0;
    this.lives[i] = Math.max(0.01, p.life);
    this.sizeStarts[i] = p.sizeStart;
    this.sizeEnds[i] = p.sizeEnd;
    this.peakAlphas[i] = p.alpha;
    this.sizes[i] = p.sizeStart;
    this.alphas[i] = 0;
  }

  update(deltaS: number): void {
    const { gravityY, drag, fadeIn } = this.physics;
    const damping = Math.exp(-drag * deltaS);
    let live = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      const life = this.lives[i];
      if (life <= 0) continue;
      const age = this.ages[i] + deltaS;
      if (age >= life) {
        this.lives[i] = 0;
        this.sizes[i] = 0;
        this.alphas[i] = 0;
        continue;
      }
      this.ages[i] = age;
      const o = i * 3;
      this.velocities[o + 1] += gravityY * deltaS;
      this.velocities[o] *= damping; this.velocities[o + 1] *= damping; this.velocities[o + 2] *= damping;
      this.positions[o] += this.velocities[o] * deltaS;
      this.positions[o + 1] += this.velocities[o + 1] * deltaS;
      this.positions[o + 2] += this.velocities[o + 2] * deltaS;
      const t = age / life;
      this.sizes[i] = this.sizeStarts[i] + (this.sizeEnds[i] - this.sizeStarts[i]) * t;
      // Montée rapide puis extinction progressive : (1 - t)² donne une fin douce.
      const rise = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1;
      this.alphas[i] = this.peakAlphas[i] * rise * (1 - t) * (1 - t);
      live += 1;
    }
    this.live = live;
  }

  /** Déplace toutes les particules vivantes (recentrage de l'origine flottante). */
  shift(dx: number, dy: number, dz: number): void {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.lives[i] <= 0) continue;
      this.positions[i * 3] -= dx; this.positions[i * 3 + 1] -= dy; this.positions[i * 3 + 2] -= dz;
    }
  }

  clear(): void {
    this.lives.fill(0);
    this.sizes.fill(0);
    this.alphas.fill(0);
    this.live = 0;
  }
}
