/**
 * Tampon circulaire de traces de pneus : chaque roue qui glisse prolonge une bande de quadrilatères posée au sol. Les
 * tableaux (positions et couleurs RGBA par sommet) sont préalloués et directement envoyés au GPU. Logique pure.
 */

/** Longueur maximale (m) entre deux points consécutifs avant de considérer la roue « téléportée » et d'interrompre la trace. */
const MAX_SEGMENT_M = 4;
/** Longueur minimale (m) d'un segment : en dessous, on attend d'avoir avancé (évite des milliers de quadrilatères au ralenti). */
const MIN_SEGMENT_M = 0.12;

interface StripEnd {
  x: number;
  y: number;
  z: number;
  alpha: number;
}

export class SkidBuffer {
  /** 4 sommets × 3 coordonnées par quadrilatère. */
  readonly positions: Float32Array;
  /** 4 sommets × RGBA par quadrilatère (couleur sombre, l'opacité varie). */
  readonly colors: Float32Array;
  /** Nombre de quadrilatères écrits au total (plafonné à la capacité pour l'affichage). */
  written = 0;
  /** Vrai si les tableaux ont changé depuis le dernier envoi au GPU. */
  dirty = false;
  private next = 0;
  private readonly ends: Array<StripEnd | null>;

  constructor(readonly capacityQuads: number, wheelCount: number, private readonly halfWidthM = 0.11, private readonly shade = 0.03) {
    this.positions = new Float32Array(capacityQuads * 12);
    this.colors = new Float32Array(capacityQuads * 16);
    this.ends = Array.from({ length: wheelCount }, () => null);
  }

  get visibleQuads(): number {
    return Math.min(this.written, this.capacityQuads);
  }

  /** À appeler après l'envoi des tableaux au GPU. */
  markUploaded(): void {
    this.dirty = false;
  }

  /** Interrompt la trace d'une roue (elle n'appuie plus, ou ne glisse plus) : la prochaine reprise démarrera une nouvelle bande. */
  breakStrip(wheel: number): void {
    this.ends[wheel] = null;
  }

  /** Prolonge la trace de la roue jusqu'à (x, y, z) avec l'opacité donnée. Renvoie vrai si un quadrilatère a été ajouté. */
  extend(wheel: number, x: number, y: number, z: number, alpha: number): boolean {
    const previous = this.ends[wheel];
    if (!previous) {
      this.ends[wheel] = { x, y, z, alpha };
      return false;
    }
    const dx = x - previous.x;
    const dz = z - previous.z;
    const length = Math.hypot(dx, dz);
    if (length > MAX_SEGMENT_M) {
      this.ends[wheel] = { x, y, z, alpha };
      return false;
    }
    if (length < MIN_SEGMENT_M) return false;
    // Largeur perpendiculaire à la direction d'avancement, dans le plan horizontal.
    const nx = (-dz / length) * this.halfWidthM;
    const nz = (dx / length) * this.halfWidthM;
    const quad = this.next;
    this.next = (this.next + 1) % this.capacityQuads;
    this.written += 1;
    const p = quad * 12;
    this.positions.set([
      previous.x - nx, previous.y, previous.z - nz,
      previous.x + nx, previous.y, previous.z + nz,
      x + nx, y, z + nz,
      x - nx, y, z - nz,
    ], p);
    const c = quad * 16;
    const s = this.shade;
    this.colors.set([s, s, s, previous.alpha, s, s, s, previous.alpha, s, s, s, alpha, s, s, s, alpha], c);
    this.ends[wheel] = { x, y, z, alpha };
    this.dirty = true;
    return true;
  }

  /** Décale toutes les traces (recentrage de l'origine flottante). */
  shift(dx: number, dy: number, dz: number): void {
    for (let i = 0; i < this.visibleQuads * 12; i += 3) {
      this.positions[i] -= dx; this.positions[i + 1] -= dy; this.positions[i + 2] -= dz;
    }
    for (const end of this.ends) {
      if (!end) continue;
      end.x -= dx; end.y -= dy; end.z -= dz;
    }
    this.dirty = true;
  }

  clear(): void {
    this.positions.fill(0);
    this.colors.fill(0);
    this.written = 0;
    this.next = 0;
    this.ends.fill(null);
    this.dirty = true;
  }
}
