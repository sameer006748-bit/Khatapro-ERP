import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const FORMAT_VERSION = 'v1'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_HEX_LENGTH = 64
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const HEX_PATTERN = /^[0-9a-f]+$/i

export type EncryptionKeyConfig = {
  key: Buffer
  keyId: string
}

function getKeyConfig(): EncryptionKeyConfig {
  const hex = process.env.AI_SETTINGS_ENCRYPTION_KEY
  const keyId = process.env.AI_SETTINGS_ENCRYPTION_KEY_ID

  if (!hex) {
    throw new Error('AI_SETTINGS_ENCRYPTION_KEY is not configured')
  }

  if (
    hex.length !== KEY_HEX_LENGTH ||
    !HEX_PATTERN.test(hex)
  ) {
    throw new Error(
      'AI_SETTINGS_ENCRYPTION_KEY must be a 32-byte, 64-character hexadecimal value',
    )
  }

  if (!keyId || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      'AI_SETTINGS_ENCRYPTION_KEY_ID must be an independent 1-64 character identifier',
    )
  }

  return {
    key: Buffer.from(hex, 'hex'),
    keyId,
  }
}

function isExactHex(value: string, byteLength: number): boolean {
  return (
    value.length === byteLength * 2 &&
    HEX_PATTERN.test(value)
  )
}

export function encrypt(
  plaintext: string,
  businessId: string,
  provider: string,
): string {
  const { key, keyId } = getKeyConfig()
  const aad = Buffer.from(
    `${FORMAT_VERSION}:${businessId}:${provider}`,
    'utf8',
  )

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })

  cipher.setAAD(aad)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    keyId,
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

export function decrypt(
  ciphertext: string,
  businessId: string,
  provider: string,
): string | null {
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 5) return null

    const [
      formatVersion,
      storedKeyId,
      ivHex,
      authTagHex,
      encryptedHex,
    ] = parts

    if (formatVersion !== FORMAT_VERSION) return null
    if (!KEY_ID_PATTERN.test(storedKeyId)) return null
    if (!isExactHex(ivHex, IV_LENGTH)) return null
    if (!isExactHex(authTagHex, TAG_LENGTH)) return null
    if (!encryptedHex || encryptedHex.length % 2 !== 0) return null
    if (!HEX_PATTERN.test(encryptedHex)) return null

    const { key, keyId } = getKeyConfig()
    if (storedKeyId !== keyId) return null

    const aad = Buffer.from(
      `${FORMAT_VERSION}:${businessId}:${provider}`,
      'utf8',
    )

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, 'hex'),
      { authTagLength: TAG_LENGTH },
    )

    decipher.setAAD(aad)
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch {
    return null
  }
}
