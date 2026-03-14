/**
 * crypto-identity.ts — Ed25519 默认签名身份
 *
 * 每个 taskd 实例启动时生成一个 Ed25519 密钥对。
 * ShardOutcome 和 SLSA Attestation 都用该身份签名，
 * 保证数据在 IPC / 磁盘传输中不被篡改。
 *
 * 安全设计：
 * - 私钥永远不暴露给外部：getPublicKey() 只返回公钥
 * - 自定义 toJSON / inspect 防止意外序列化到日志
 * - privateKey Buffer 在使用后不被缓存为可导出字符串
 */
import * as crypto from 'node:crypto'

// ── 类型定义 ────────────────────────────────────────────────────

export interface SignedPayload<T = unknown> {
  payload: T
  signature: string   // Base64 编码
  publicKey: string   // Base64 编码
  algorithm: 'ed25519'
  signedAt: string
}

export interface CryptoIdentity {
  /** 仅返回公钥（Base64），不暴露私钥 */
  getPublicKeyBase64(): string
  signPayload<T>(payload: T): SignedPayload<T>
  verifyPayload<T>(signed: SignedPayload<T>): boolean
}

// ── 实现 ────────────────────────────────────────────────────────

export class Ed25519Identity implements CryptoIdentity {
  /** 私钥仅在内存中保存为 DER Buffer，不导出为字符串 */
  private readonly _privateKey: Buffer
  private readonly _publicKeyDer: Buffer
  private readonly _publicKeyBase64: string

  constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    this._privateKey = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
    this._publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
    this._publicKeyBase64 = this._publicKeyDer.toString('base64')
  }

  getPublicKeyBase64(): string {
    return this._publicKeyBase64
  }

  signPayload<T>(payload: T): SignedPayload<T> {
    const canonical = JSON.stringify(payload)
    const privateKey = crypto.createPrivateKey({
      key: this._privateKey,
      format: 'der',
      type: 'pkcs8',
    })
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey)

    return {
      payload,
      signature: signature.toString('base64'),
      publicKey: this._publicKeyBase64,
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

  /** 防止 JSON.stringify(identity) 泄漏私钥 */
  toJSON(): { publicKey: string; algorithm: string } {
    return { publicKey: this._publicKeyBase64, algorithm: 'ed25519' }
  }

  /** 防止 console.log(identity) 泄漏私钥 */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Ed25519Identity { publicKey: "${this._publicKeyBase64.slice(0, 16)}..." }`
  }
}
