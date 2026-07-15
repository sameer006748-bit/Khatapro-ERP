/**
 * Phase 10.1 — AI secret encryption unit tests.
 * Focused, no live Supabase, no network.
 * Uses Node's built-in test runner (node --test).
 */
import { strict as assert } from 'node:assert'
import crypto from 'node:crypto'
import test from 'node:test'
import { encrypt, decrypt } from '../src/lib/security/ai-secret-encryption'

const TEST_KEY = crypto.randomBytes(32).toString('hex')
const TEST_KEY_ID = `key-${TEST_KEY.slice(0, 8)}`
const BUSINESS_ID = 'biz-test-123'
const PROVIDER = 'gemini'

test('encrypts and decrypts a round trip', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'AIzaSyTestGeminiKey1234567890abcdef'
  const ciphertext = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  assert.ok(!ciphertext.includes(plaintext))
  const decrypted = decrypt(ciphertext, BUSINESS_ID, PROVIDER)
  assert.equal(decrypted, plaintext)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})

test('produces a different IV for the same plaintext', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'same-key-value'
  const c1 = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  const c2 = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  assert.notEqual(c1, c2)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})

test('rejects tampered ciphertext', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'tamper-me'
  const ciphertext = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  const parts = ciphertext.split(':')
  const tampered = [...parts]
  tampered[4] = parts[4].slice(0, -1) + (parts[4].slice(-1) === 'a' ? 'b' : 'a')
  const result = decrypt(tampered.join(':'), BUSINESS_ID, PROVIDER)
  assert.equal(result, null)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})

test('rejects wrong AAD (different businessId)', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'cross-biz'
  const ciphertext = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  const decrypted = decrypt(ciphertext, 'other-business', PROVIDER)
  assert.equal(decrypted, null)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})

test('rejects wrong AAD (different provider)', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'cross-provider'
  const ciphertext = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  const decrypted = decrypt(ciphertext, BUSINESS_ID, 'openai')
  assert.equal(decrypted, null)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})

test('rejects malformed encryption key', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = 'tooshort'
  assert.throws(() => encrypt('x', BUSINESS_ID, PROVIDER), /64-character/)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
})

test('unknown key ID produces configuration_error (decrypt returns null)', () => {
  process.env.AI_SETTINGS_ENCRYPTION_KEY = TEST_KEY
  process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = TEST_KEY_ID
  const plaintext = 'rotate-me'
  const ciphertext = encrypt(plaintext, BUSINESS_ID, PROVIDER)
  const parts = ciphertext.split(':')
  const rotated = [...parts]
  rotated[1] = 'key-different'
  const result = decrypt(rotated.join(':'), BUSINESS_ID, PROVIDER)
  assert.equal(result, null)
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY_ID
})