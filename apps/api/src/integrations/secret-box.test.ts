import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config';
import { SecretBox } from './secret-box';

const box = () =>
  new SecretBox(loadConfig({ INTEGRATIONS_KEY: randomBytes(32).toString('base64') }));
describe('SET-02 SecretBox', () => {
  it('round trips, including Unicode, without plaintext in the envelope', () => {
    const b = box();
    const tenant = randomUUID();
    const secret = 'test-secret-සිංහල';
    const sealed = b.seal(tenant, secret);
    expect(b.open(tenant, sealed)).toBe(secret);
    expect(sealed.secretCiphertext.includes(Buffer.from(secret))).toBe(false);
    expect(sealed.secretNonce.length).toBe(12);
  });
  it('rejects wrong tenant AAD, wrong key and unknown key id', () => {
    const b = box();
    const tenant = randomUUID();
    const sealed = b.seal(tenant, 'test-secret');
    expect(() => b.open(randomUUID(), sealed)).toThrow();
    expect(() => box().open(tenant, sealed)).toThrow();
    expect(() => b.open(tenant, { ...sealed, keyId: 'old' })).toThrow();
  });
  it('rejects tampered ciphertext, tag and nonce', () => {
    const b = box();
    const tenant = randomUUID();
    const sealed = b.seal(tenant, 'test-secret');
    for (const position of [0, sealed.secretCiphertext.length - 1]) {
      const changed = Buffer.from(sealed.secretCiphertext);
      changed[position] = changed[position]! ^ 1;
      expect(() => b.open(tenant, { ...sealed, secretCiphertext: changed })).toThrow();
    }
    expect(() => b.open(tenant, { ...sealed, secretNonce: randomBytes(12) })).toThrow();
  });
  it('rejects otherwise valid AES-GCM envelopes with shorter authentication tags', () => {
    const key = randomBytes(32);
    const b = new SecretBox(loadConfig({ INTEGRATIONS_KEY: key.toString('base64') }));
    const tenant = randomUUID();
    const secret = 'test-only-merchant-secret-with-enough-ciphertext';
    expect(b.seal(tenant, secret).secretCiphertext.length).toBe(Buffer.byteLength(secret) + 16);
    for (const authTagLength of [4, 8, 12, 15]) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength });
      cipher.setAAD(Buffer.from(tenant, 'utf8'));
      const ciphertext = Buffer.concat([
        cipher.update(secret, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      expect(() =>
        b.open(tenant, { secretCiphertext: ciphertext, secretNonce: nonce, keyId: 'v1' }),
      ).toThrow();
    }
  });
  it('never reuses a nonce across writes', () => {
    const b = box();
    const tenant = randomUUID();
    const nonces = Array.from({ length: 1000 }, () =>
      b.seal(tenant, 'test-secret').secretNonce.toString('hex'),
    );
    expect(new Set(nonces).size).toBe(nonces.length);
  });
  it('requires a configured key for writes, without generating an ephemeral default', () => {
    expect(() => new SecretBox(loadConfig({})).seal(randomUUID(), 'test-secret')).toThrow(
      'INTEGRATIONS_KEY',
    );
  });
});
