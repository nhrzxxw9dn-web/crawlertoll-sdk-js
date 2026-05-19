import { describe, it, expect } from "vitest";
import * as ed from "@noble/ed25519";

import { verify, signEnvelope } from "../src/verify.js";
import { rawEd25519PublicKeyToPem } from "../src/pem.js";
import type { AttestationEnvelope } from "../src/types.js";

async function freshKeypair() {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  const pem = rawEd25519PublicKeyToPem(publicKey);
  return { secretKey, publicKey, pem };
}

function unsigned(now: Date = new Date()): Omit<AttestationEnvelope, "signature"> {
  return {
    magic: "ct_att_v1",
    attestation_id: "ct_att_test_0000000000000001",
    publisher: "matriculix",
    endpoint: "isv-calculator",
    request_hash: "a".repeat(64),
    response_hash: "b".repeat(64),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 90 * 86400 * 1000).toISOString(),
    kid: "ct_sign_test_001",
  };
}

describe("verify() happy path", () => {
  it("accepts an envelope signed with the matching key", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    const result = await verify(env, pem);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe("verify() rejection modes", () => {
  it("rejects an envelope with the wrong magic", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    const tampered = { ...env, magic: "ct_att_v2" as unknown as "ct_att_v1" };
    const result = await verify(tampered, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-magic");
  });

  it("rejects an envelope verified against a different publisher's key", async () => {
    const real = await freshKeypair();
    const wrong = await freshKeypair();
    const env = await signEnvelope(unsigned(), real.secretKey);
    const result = await verify(env, wrong.pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects an envelope whose payload was tampered with after signing", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    const tampered = { ...env, response_hash: "c".repeat(64) };
    const result = await verify(tampered, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects an expired envelope", async () => {
    const { secretKey, pem } = await freshKeypair();
    const oldDate = new Date("2020-01-01T00:00:00Z");
    const env = await signEnvelope(unsigned(oldDate), secretKey);
    const result = await verify(env, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects an envelope dated in the future beyond the skew window", async () => {
    const { secretKey, pem } = await freshKeypair();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day ahead
    const env = await signEnvelope(unsigned(future), secretKey);
    const result = await verify(env, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("future-dated");
  });

  it("rejects a malformed signature (wrong length)", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    const tampered = { ...env, signature: "AAAA" }; // 3 bytes
    const result = await verify(tampered, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  it("rejects a bad PEM key", async () => {
    const { secretKey } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    const result = await verify(env, "not a real pem");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("bad-key");
  });

  it("rejects an envelope with invalid timestamps", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(
      { ...unsigned(), issued_at: "not-a-date", expires_at: "also-not" },
      secretKey,
    );
    const result = await verify(env, pem);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });
});

describe("signEnvelope()", () => {
  it("strips an existing signature field before re-signing", async () => {
    const { secretKey, pem } = await freshKeypair();
    const env = await signEnvelope(unsigned(), secretKey);
    // Re-sign — must still verify.
    const resigned = await signEnvelope(env, secretKey);
    expect(await verify(resigned, pem)).toEqual({ valid: true });
  });

  it("rejects a 31-byte secret key", async () => {
    await expect(signEnvelope(unsigned(), new Uint8Array(31))).rejects.toThrow();
  });
});
