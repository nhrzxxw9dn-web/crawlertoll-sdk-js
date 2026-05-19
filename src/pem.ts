/**
 * PEM ↔ raw byte helpers for Ed25519 keys.
 *
 * The Context License spec stores public keys as PEM-encoded SPKI
 * (Subject Public Key Info). For Ed25519 specifically, the SPKI
 * payload is a fixed 12-byte ASN.1 prefix followed by the 32-byte
 * raw key — so we can extract the raw key by pattern-matching the
 * prefix instead of pulling in a full ASN.1 parser.
 *
 * The prefix bytes are:
 *   30 2a            SEQUENCE (44 bytes)
 *   30 05            SEQUENCE (5 bytes)  ─ algorithm identifier
 *   06 03 2b 65 70   OID 1.3.101.112 ─ Ed25519
 *   03 21 00         BIT STRING (33 bytes, 0 unused bits)
 *   ... 32 bytes of raw key ...
 *
 * Total SPKI envelope: 44 bytes. Validated below.
 */

const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/**
 * Decode a PEM-encoded SPKI Ed25519 public key into raw 32-byte form.
 * Throws if the input isn't valid Ed25519 SPKI.
 */
export function pemToRawEd25519PublicKey(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  if (b64.length === 0) {
    throw new Error("PEM body is empty");
  }
  const der = base64ToBytes(b64);
  if (der.length !== 44) {
    throw new Error(
      `Not a valid Ed25519 SPKI public key: expected 44 bytes, got ${der.length}`,
    );
  }
  for (let i = 0; i < ED25519_SPKI_PREFIX.length; i++) {
    if (der[i] !== ED25519_SPKI_PREFIX[i]) {
      throw new Error(
        `Not a valid Ed25519 SPKI public key: prefix byte ${i} mismatch`,
      );
    }
  }
  return der.slice(12);
}

/**
 * Wrap a raw 32-byte Ed25519 public key as a PEM-encoded SPKI string.
 * Useful for tests that generate a keypair and need to surface the
 * public key in the same format publishers serve via
 * context-license.json.
 */
export function rawEd25519PublicKeyToPem(rawKey: Uint8Array): string {
  if (rawKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${rawKey.length}`);
  }
  const der = new Uint8Array(44);
  der.set(ED25519_SPKI_PREFIX, 0);
  der.set(rawKey, 12);
  const b64 = bytesToBase64(der);
  // 64-char wrap to match the convention most PEM emitters use.
  const wrapped = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`;
}

// ─── Base64 helpers (portable across Node / browser / edge) ────────

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
