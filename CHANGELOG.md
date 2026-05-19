# Changelog

## v0.1.0 — 2026-05-19 (initial)

Initial buyer SDK skeleton.

- `CrawlerTollClient` with `discover()` + `query()`. v0 returns bundled
  fixture data with `demo: true` flags. HTTP path to the platform
  Worker (per `PLATFORM_ARCHITECTURE.md`) ships when the backend is live.
- `verify(envelope, publicKeyPem)` — real Ed25519 + JCS RFC 8785
  canonicalisation. Cryptographically verifies attestation envelopes.
  Checks magic, signature, key, and validity window (5-min clock skew).
- `signEnvelope(envelope, secretKey)` — companion sign helper for tests
  and publisher implementations.
- `pemToRawEd25519PublicKey` + `rawEd25519PublicKeyToPem` — pure PEM
  helpers that work in Node, Bun, Deno, browsers, Cloudflare Workers.
- Full TypeScript types: `CrawlerTollClientOptions`, `DiscoverOptions`,
  `PublisherCard`, `DiscoverResult`, `QueryOptions`, `QueryResult`,
  `AttestationEnvelope`, `VerifyResult`, `CrawlerTollError`.

Built on `@noble/ed25519` + `@noble/hashes/sha512` + `canonicalize`.
No Node-specific crypto dependencies — runs everywhere the spec needs to.

Tests (24/24 pass at release):
- `tests/pem.test.ts` — PEM round-trip + rejection cases.
- `tests/verify.test.ts` — happy path + 8 rejection modes (bad magic,
  wrong key, tampered payload, expired, future-dated, malformed
  signature, bad PEM, invalid timestamps).
- `tests/client.test.ts` — construction defaults + discover filters +
  query happy path with end-to-end signature verification.
