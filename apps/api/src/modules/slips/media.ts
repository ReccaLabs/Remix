import decodeHeic from 'heic-decode';
import sharp, { type Sharp } from 'sharp';

/** Longest edge of a processed slip image (ADR 0009). */
export const MAX_IMAGE_EDGE = 2560;
/** Refuse decoding anything larger (a small HEIC/PNG can declare enormous dimensions). */
export const MAX_INPUT_PIXELS = 50_000_000;

export type SniffedImage = 'jpeg' | 'png' | 'heif';

/** HEIF brands (ISO/IEC 23008-12) libheif can decode; AVIF-only files are not slips. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * The image type from the file's magic bytes. The extension and the declared content type are
 * never consulted: a renamed PDF or executable is `null`.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 12))) return 'heif';
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** The file is not an image we can decode. The slip becomes `rejected` ("Unreadable file"). */
export class UnreadableImageError extends Error {
  constructor(reason: string) {
    super(`Unreadable image: ${reason}`);
    this.name = 'UnreadableImageError';
  }
}

/**
 * Re-encode an uploaded slip photo as a fresh JPEG (ADR 0009): decode by sniffed type (HEIC/HEIF
 * through a pure-JS libheif build, because sharp's prebuilt libvips has no HEVC decoder), apply
 * the orientation, cap the longest edge at {@link MAX_IMAGE_EDGE}, flatten transparency and write
 * a new file with no metadata at all (EXIF, GPS, XMP, ICC and comments are dropped). The
 * re-encode is the sanitiser: nothing from the original container survives.
 */
export async function reencodeSlipImage(input: Buffer): Promise<Buffer> {
  const type = sniffImage(input);
  if (!type) throw new UnreadableImageError('not a JPEG, PNG or HEIC file');
  let pipeline: Sharp;
  try {
    if (type === 'heif') {
      pipeline = await decodeHeif(input);
    } else {
      const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (meta.format !== type) throw new UnreadableImageError('content does not match its signature');
      // `.rotate()` without an angle applies the EXIF orientation before the tags are dropped.
      pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    }
    return await pipeline
      .timeout({ seconds: 30 })
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof UnreadableImageError) throw error;
    throw new UnreadableImageError(error instanceof Error ? error.message.slice(0, 120) : 'decode failed');
  }
}

/** libheif applies the container's rotation/mirror (`irot`/`imir`) while decoding. */
async function decodeHeif(input: Buffer): Promise<Sharp> {
  const images = await decodeHeic.all({ buffer: input });
  try {
    const primary = images[0];
    if (!primary) throw new UnreadableImageError('no image in the HEIF container');
    if (primary.width < 1 || primary.height < 1 || primary.width * primary.height > MAX_INPUT_PIXELS) {
      throw new UnreadableImageError('image dimensions out of range');
    }
    const decoded = await primary.decode();
    const raw = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    return sharp(raw, { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
  } finally {
    images.dispose();
  }
}
