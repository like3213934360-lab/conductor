/**
 * crypto-identity.ts — Ed25519 默认签名身份
 *
 * 每个 taskd 实例启动时生成一个 Ed25519 密钥对。
 * ShardOutcome 和 SLSA Attestation 都用该身份签名，
 * 保证数据在 IPC / 磁盘传输中不被篡改。
 */
import * as crypto from 'node:crypto'

// ── 类型定义 ────────────────────────────────────────────────────

export interface KeyPair {
  publicKey: Buffer
  privateKey: Buffer
}

export interface SignedPayload<T = unknown> {
  payload: T
  signature: string   // Base64 编码
  publicKey: string   // Base64 编码
  algorithm: 'ed25519'
  signedAt: string
}

export interface CryptoIdentity {
  getKeyPair(): KeyPair
  signPayload<T>(payload: T): SignedPayload<T>
  verifyPayload<T>(signed: SignedPayload<T>): boolean
}

// ── 实现 ────────────────────────────────────────────────────────

export class Ed25519Identity implements CryptoIdentity {
  private readonly keyPair: KeyPair

  constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    this.keyPair = {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer,
    }
  }

  getKeyPair(): KeyPair {
    return this.keyPair
  }

  signPayload<T>(payload: T): SignedPayload<T> {
    const canonical = JSON.stringify(payload)
    const privateKey = crypto.createPrivateKey({
      key: this.keyPair.privateKey,
      format: 'der',
      type: 'pkcs8',
    })
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey)

    return {
      payload,
      signature: signature.toString('base64'),
      publicKey: this.keyPair.publicKey.toString('base64'),
      algorithm: 'ed25519',
      signedAt: new Date().toISOString(),
    }
  }

  verifyPayload<T>(signed: SignedPayload<T>): boolean {
    try {
      const canonical = JSON.stringify(signed.payload)
      const publicKey = crypto.createPublicKey({
        key: Buffer.from(signed.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      })
      return crypto.verify(
        null,
        Buffer.from(canonical, 'utf8'),
        publicKey,
        Buffer.from(signed.signature, 'base64'),
      )
    } catch {
      return false
    }
  }
}
