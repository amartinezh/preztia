// Aleatoriedad DETERMINISTA del seed: la misma semilla produce exactamente los mismos datos en
// cada corrida (reproducible en local y en producción). Nunca usar Math.random() en el seed.

const UINT32 = 0x1_0000_0000;

/** Generador mulberry32: rápido, de 32 bits y suficiente para datos de prueba. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Real en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  /** Entero en [min, max] (ambos inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** ¿Ocurre un evento de probabilidad `p`? */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() sobre una lista vacía');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Copia barajada (Fisher–Yates); no muta la entrada. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Cadena alfanumérica de longitud fija (identificadores de proveedores, E2E). */
  alphanumeric(length: number): string {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[this.int(0, 61)];
    return out;
  }

  /** Cadena de dígitos de longitud fija. */
  digits(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String(this.int(0, 9));
    return out;
  }

  /** Hexadecimal de longitud fija (huellas sha256 simuladas, ids de media). */
  hex(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += this.int(0, 15).toString(16);
    return out;
  }
}
