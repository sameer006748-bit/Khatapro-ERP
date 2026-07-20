/**
 * Server-only AES-256-GCM encryption for AI provider API keys.
 *
 * AAD binds every ciphertext to its format version, business, and provider.
 *
 * Key rotation:
 * 1. Keep the old key available during a controlled maintenance window.
 * 2. Decrypt existing records with the old key.
 * 3. Re-encrypt them with the new key.
 * 4. Update each record's encryptionKeyId.
 *
 * The key ID is an independent non-secret label. It must never be derived
 * from any portion of the encryption key.
 */
import 'server-only'
export { decrypt, encrypt } from './ai-secret-encryption-core'
export type { EncryptionKeyConfig } from './ai-secret-encryption-core'
