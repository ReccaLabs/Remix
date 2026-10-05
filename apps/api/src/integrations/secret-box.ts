import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface SecretEnvelope { secretCiphertext: Buffer; secretNonce: Buffer; keyId: string }

/** ADR 0008 §9. Key ids identify the configured key; unknown ids fail closed on rotation. */
@Injectable()
export class SecretBox {
  private readonly key?: Buffer;
  private readonly keyId: string;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.keyId = config.integrationsKeyId;
    if (config.integrationsKey) {
      const key = Buffer.from(config.integrationsKey, 'base64');
      if (key.length !== 32 || key.toString('base64') !== config.integrationsKey) throw new Error('Invalid INTEGRATIONS_KEY encoding');
      this.key = key;
    }
  }
  seal(tenantId: string, secret: string): SecretEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), nonce);
    cipher.setAAD(Buffer.from(tenantId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { secretCiphertext: ciphertext, secretNonce: nonce, keyId: this.keyId };
  }
  open(tenantId: string, envelope: SecretEnvelope): string {
    if (envelope.keyId !== this.keyId || envelope.secretNonce.length !== 12 || envelope.secretCiphertext.length < 16) {
      throw new Error('Invalid integration secret envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), envelope.secretNonce);
    decipher.setAAD(Buffer.from(tenantId, 'utf8'));
    decipher.setAuthTag(envelope.secretCiphertext.subarray(-16));
    return Buffer.concat([decipher.update(envelope.secretCiphertext.subarray(0, -16)), decipher.final()]).toString('utf8');
  }
  private requireKey(): Buffer {
    if (!this.key) throw new Error('INTEGRATIONS_KEY is not configured');
    return this.key;
  }
}
