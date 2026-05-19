/**
 * Attestation envelope verification — real Ed25519 + JCS RFC 8785
 * canonicalization. The signing input is the canonical JSON encoding
 * of the envelope minus its `signature` field, domain-separated by
 * the magic constant `"ct_att_v1"`.
 *
 * Two exports:
 *   - verify(envelope, publicKeyPem)   — buyer-side verification path.
 *   - signEnvelope(envelope, secretKey) — used by tests and (eventually)
 *     publisher implementations to produce a signature.
 *
 * Built on @noble/ed25519 + @noble/hashes/sha512 so it works
 * everywhere Node 18+, Bun, Deno, browsers, and Cloudflare Workers run.
 */

import * as ed from "@noble/ed25519";
import canonicalize from "canonicalize";

import { pemToRawEd25519PublicKey } from "./pem.js";
import type { AttestationEnvelope, VerifyResult } from "./types.js";

// @noble/ed25519 v2's default `etc.sha512Async` already wraps the
// platform WebCrypto SHA-512 (Node 18+ / Bun / Deno / browsers /
// Cloudflare Workers all ship this). We use `verifyAsync` and
// `signAsync` exclusively, so no manual wiring is required.

const MAGIC = "ct_att_v1" as const;
const ENCODER = new TextEncoder();

/**
 * Verify a signed attestation envelope against a PEM-encoded Ed25519
 * public key.
 *
 * Returns a `VerifyResult` with `valid: true` if and only if:
 *   1. `magic` is `"ct_att_v1"`.
 *   2. The PEM decodes to a valid 32-byte Ed25519 public key.
 *   3. The signature decodes to 64 bytes.
 *   4. The signature verifies cryptographically against the JCS-
 *      canonical encoding of the envelope (minus `signature`).
 *   5. The envelope is not expired (`expires_at` > now) and not
 *      future-dated (`issued_at` ≤ now + 5min skew).
 *
 * Never throws on validation outcomes — returns a structured verdict.
 * Throws only on truly malformed input (e.g. non-JSON envelope).
 */
export async function verify(
  envelope: AttestationEnvelope,
  publicKeyPem: string,
  options?: { clockSkewMs?: number; now?: Date },
): Promise<VerifyResult> {
  if (envelope.magic !== MAGIC) {
    return {
      valid: false,
      reason: "bad-magic",
      detail: `expected magic "${MAGIC}", got "${envelope.magic}"`,
    };
  }

  // ─── Temporal checks ───
  const now = options?.now ?? new Date();
  const skewMs = options?.clockSkewMs ?? 5 * 60 * 1000;
  const issuedAt = Date.parse(envelope.issued_at);
  const expiresAt = Date.parse(envelope.expires_at);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) {
    return {
      valid: false,
      reason: "malformed",
      detail: "issued_at or expires_at is not a valid ISO-8601 timestamp",
    };
  }
  if (now.getTime() > expiresAt) {
    return {
      valid: false,
      reason: "expired",
      detail: `expired at ${envelope.expires_at}, now is ${now.toISOString()}`,
    };
  }
  if (issuedAt > now.getTime() + skewMs) {
    return {
      valid: false,
      reason: "future-dated",
      detail: `issued_at ${envelope.issued_at} is more than ${skewMs}ms in the future`,
    };
  }

  // ─── Crypto checks ───
  let publicKey: Uint8Array;
  try {
    publicKey = pemToRawEd25519PublicKey(publicKeyPem);
  } catch (err) {
    return {
      valid: false,
      reason: "bad-key",
      detail: (err as Error).message,
    };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64ToBytes(envelope.signature);
  } catch (err) {
    return {
      valid: false,
      reason: "malformed",
      detail: `signature is not valid base64: ${(err as Error).message}`,
    };
  }
  if (signatureBytes.length !== 64) {
    return {
      valid: false,
      reason: "malformed",
      detail: `Ed25519 signature must be 64 bytes, got ${signatureBytes.length}`,
    };
  }

  const signedBytes = canonicalSigningInput(envelope);

  let valid: boolean;
  try {
    valid = await ed.verifyAsync(signatureBytes, signedBytes, publicKey);
  } catch (err) {
    return {
      valid: false,
      reason: "bad-signature",
      detail: (err as Error).message,
    };
  }
  if (!valid) {
    return {
      valid: false,
      reason: "bad-signature",
      detail: "Ed25519 verification returned false",
    };
  }
  return { valid: true };
}

/**
 * Sign an envelope. Returns the envelope with its `signature` field
 * populated. The input `envelope` argument may have a `signature`
 * field already — it's stripped before signing.
 *
 * Intended for publisher SDKs and tests. Buyer-side code only uses
 * `verify()`.
 */
export async function signEnvelope(
  envelope: Omit<AttestationEnvelope, "signature"> & { signature?: string },
  secretKey: Uint8Array,
): Promise<AttestationEnvelope> {
  if (secretKey.length !== 32) {
    throw new Error(`Ed25519 secret key must be 32 bytes, got ${secretKey.length}`);
  }
  const signedBytes = canonicalSigningInput(envelope);
  const sig = await ed.signAsync(signedBytes, secretKey);
  return {
    ...envelope,
    signature: bytesToBase64(sig),
  } as AttestationEnvelope;
}

// ─── Internal: build the canonical signing input ───────────────────

function canonicalSigningInput(
  envelope: Omit<AttestationEnvelope, "signature"> & { signature?: string },
): Uint8Array {
  // Drop signature before canonicalisation — we're signing everything
  // *except* the signature itself.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _omit, ...rest } = envelope;
  const canonical = canonicalize(rest);
  if (typeof canonical !== "string") {
    throw new Error("canonicalize() did not return a string");
  }
  // Domain-separate the signing input with the magic constant so a
  // valid signature on one envelope shape can't be replayed against
  // a different envelope shape that happens to canonicalise the same.
  return ENCODER.encode(MAGIC + ":" + canonical);
}

// ─── Local byte helpers ────────────────────────────────────────────

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

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
