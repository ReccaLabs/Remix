import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, reencodeSlipImage, sniffImage, UnreadableImageError } from './media';

const HEIC = readFileSync(new URL('../../../test/fixtures/media/slip-hevc.heic', import.meta.url));

/** A 40×20 JPEG, left half red, with EXIF orientation 6 (rotate 90° CW), a camera and GPS tags. */
async function jpegWithExif(): Promise<Buffer> {
  const left = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#dc1414' } }).png().toBuffer();
  return sharp({ create: { width: 40, height: 20, channels: 3, background: '#1414dc' } })
    .composite([{ input: left, left: 0, top: 0 }])
    .withExif({
      IFD0: { Make: 'FixtureCam', Model: 'SecretPhone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 55/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '79/1 51/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

async function pixel(jpeg: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
}

describe('sniffImage', () => {
  it('recognises JPEG, PNG and HEIC by their magic bytes only', async () => {
    expect(sniffImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer())).toBe('png');
    expect(sniffImage(HEIC)).toBe('heif');
  });

  it('rejects renamed non-images and look-alikes', () => {
    for (const bytes of [
      Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'),
      Buffer.from('MZ\x90\x00\x03\x00\x00\x00'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('GIF89a\x01\x00\x01\x00'),
      Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]), // ftyp avif
      Buffer.from([0xff, 0xd8]),
      Buffer.alloc(0),
    ]) {
      expect(sniffImage(bytes)).toBeNull();
    }
  });
});

describe('reencodeSlipImage', () => {
  it('refuses a renamed non-image and a corrupt JPEG as unreadable', async () => {
    await expect(reencodeSlipImage(Buffer.from('%PDF-1.7 renamed to slip.jpg'))).rejects.toBeInstanceOf(UnreadableImageError);
    const jpeg = await jpegWithExif();
    await expect(reencodeSlipImage(jpeg.subarray(0, 200))).rejects.toBeInstanceOf(UnreadableImageError);
    await expect(reencodeSlipImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 7)]))).rejects.toBeInstanceOf(
      UnreadableImageError,
    );
  });

  it('applies the EXIF orientation, then removes EXIF, GPS and every other metadata block', async () => {
    const input = await jpegWithExif();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.toString('latin1')).toContain('SecretPhone');

    const output = await reencodeSlipImage(input);
    const after = await sharp(output).metadata();
    expect(after.format).toBe('jpeg');
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    const text = output.toString('latin1');
    for (const leak of ['Exif', 'SecretPhone', 'FixtureCam', 'GPS']) expect(text).not.toContain(leak);
    // Rotated 90° clockwise: the red left half is now on top.
    const [r, , b] = await pixel(output, 10, 5);
    expect(r).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
  });

  it('converts an HEVC HEIC (which sharp alone cannot decode) to a clean JPEG', async () => {
    await expect(sharp(HEIC).toBuffer()).rejects.toThrow();
    const output = await reencodeSlipImage(HEIC);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([64, 48]);
    expect(meta.exif).toBeUndefined();
    expect(output.toString('latin1')).not.toContain('FixtureCam');
    const [r1, , b1] = await pixel(output, 8, 24);
    const [r2, , b2] = await pixel(output, 56, 24);
    expect(r1).toBeGreaterThan(150);
    expect(b1).toBeLessThan(100);
    expect(b2).toBeGreaterThan(150);
    expect(r2).toBeLessThan(100);
  });

  it('caps the longest edge and flattens PNG transparency', async () => {
    const wide = await sharp({ create: { width: 3000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const output = await reencodeSlipImage(wide);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([MAX_IMAGE_EDGE, 853]);
    expect(meta.hasAlpha).toBe(false);
    expect(await pixel(output, 5, 5)).toEqual([255, 255, 255]);
    const small = await reencodeSlipImage(await sharp({ create: { width: 30, height: 10, channels: 3, background: '#888' } }).png().toBuffer());
    expect((await sharp(small).metadata()).width).toBe(30);
  });
});
