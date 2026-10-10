// Décodeur PNG minimal (8 bits, RVB ou RVBA, sans entrelacement) pour les tuiles d'altitude : évite une dépendance pour le prototype.
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, i) => buffer[i] !== byte)) throw new Error('Ce n\'est pas un PNG.');
  let offset = 8;
  let width = 0; let height = 0; let depth = 0; let colorType = 0; let interlace = 0;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`PNG non géré (profondeur ${depth}, type ${colorType}, entrelacement ${interlace}).`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = pixels[i * channels]; rgba[i * 4 + 1] = pixels[i * channels + 1]; rgba[i * 4 + 2] = pixels[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}
