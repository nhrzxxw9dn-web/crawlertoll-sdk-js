# Changelog

## v0.1.2 — 2026-05-21

### Changed

- Repository URL updated after the GitHub org rename `nhrzxxw9dn-web` → `charthouse-ltd` (npm scope unchanged: `@crawlertoll/*`). Metadata-only release; no code changes.

## v0.1.1 — 2026-05-19

- **Bump minimum Node to 20.** `@noble/ed25519` reads
  `globalThis.crypto.getRandomValues`, which only became global in
  Node 19+. Node 18 (EOL April 2025) is no longer supported.
- **Friendly load-time guard.** The package now throws a clear,
  actionable error at module load if it can't find Web Crypto,
  rather than failing inside a key-generation call stack with
  `Cannot read properties of undefined (reading 'getRandomValues')`.
- CI matrix dropped 18.x.

No source-code changes to `discover`, `query`, `verify`, or
`signEnvelope`. Behaviour is identical on Node 20+.

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
