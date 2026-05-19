import { describe, it, expect } from "vitest";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  pemToRawEd25519PublicKey,
  rawEd25519PublicKeyToPem,
} from "../src/pem.js";

describe("pemToRawEd25519PublicKey()", () => {
  it("round-trips a Node-generated Ed25519 SPKI PEM", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ format: "pem", type: "spki" }) as string;
    const raw = pemToRawEd25519PublicKey(pem);
    expect(raw).toBeInstanceOf(Uint8Array);
    expect(raw.length).toBe(32);
  });

  it("rejects a non-PEM string", () => {
    expect(() => pemToRawEd25519PublicKey("not a pem")).toThrow();
  });

  it("rejects an empty PEM body", () => {
    expect(() =>
      pemToRawEd25519PublicKey(
        "-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----",
      ),
    ).toThrow(/empty/i);
  });

  it("rejects an RSA SPKI key (wrong algorithm)", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ format: "pem", type: "spki" }) as string;
    expect(() => pemToRawEd25519PublicKey(pem)).toThrow();
  });
});

describe("rawEd25519PublicKeyToPem()", () => {
  it("produces a PEM that Node's crypto can parse back as Ed25519", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const raw = pemToRawEd25519PublicKey(
      publicKey.export({ format: "pem", type: "spki" }) as string,
    );

    const pem = rawEd25519PublicKeyToPem(raw);
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(pem).toMatch(/-----END PUBLIC KEY-----$/);

    // Parse back via Node — confirms valid SPKI / Ed25519 OID.
    const parsed = createPublicKey({ key: pem, format: "pem" });
    expect(parsed.asymmetricKeyType).toBe("ed25519");
  });

  it("rejects a non-32-byte key", () => {
    expect(() => rawEd25519PublicKeyToPem(new Uint8Array(31))).toThrow();
    expect(() => rawEd25519PublicKeyToPem(new Uint8Array(33))).toThrow();
  });
});
