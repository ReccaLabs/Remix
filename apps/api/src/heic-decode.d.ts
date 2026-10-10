// heic-decode ships no types. Only the parts the media worker uses are declared.
declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 8 bits per channel. */
    data: Uint8ClampedArray;
  }
  interface HeifImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }
  interface HeifImages extends Array<HeifImage> {
    dispose(): void;
  }
  interface Decode {
    (input: { buffer: Uint8Array }): Promise<DecodedImage>;
    all(input: { buffer: Uint8Array }): Promise<HeifImages>;
  }
  const decode: Decode;
  export default decode;
}
