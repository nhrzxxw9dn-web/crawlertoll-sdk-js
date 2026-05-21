# @crawlertoll/client

Buyer SDK for **CrawlerToll** — discover publishers, query MCP endpoints,
and verify the signed attestation envelope every response carries. Built
for Claude Agent SDK developers and any agent that wants cited, attested,
paid access to structured publisher content.

- **Spec**: [context-license.org/v0.1](https://context-license.org/v0.1) (CC0 1.0)
- **Marketplace**: [crawlertoll.com](https://crawlertoll.com)
- **Parser companion**: [`@crawlertoll/parser`](https://github.com/charthouse-ltd/crawlertoll-parser-js) — pure JSON Schema validator + TS types
- **License**: Apache 2.0 (this SDK). Spec itself is CC0.

> **Status**: v0.1 skeleton. `discover()` and `query()` operate against
> bundled fixture data while the platform Worker (per
> `PLATFORM_ARCHITECTURE.md`) is built. `verify()` is real today —
> Ed25519 + JCS RFC 8785 canonicalisation, works against any Context
> License publisher's signing key.

---

## Install

```bash
npm install @crawlertoll/client
# or
pnpm add @crawlertoll/client
yarn add @crawlertoll/client
```

**Node 20+** (any runtime with a global `fetch`, global `crypto.getRandomValues`, and ES2022 — Bun, Deno, Cloudflare Workers, browsers all qualify). Node 18 hit end-of-life April 2025 and doesn't expose Web Crypto globally without `--experimental-global-webcrypto`; the SDK throws at module load if it can't find it.

[![npm](https://img.shields.io/npm/v/%40crawlertoll%2Fclient.svg)](https://www.npmjs.com/package/@crawlertoll/client) [![license](https://img.shields.io/npm/l/%40crawlertoll%2Fclient.svg)](./LICENSE)

## Quick start

```ts
import { CrawlerTollClient, verify } from "@crawlertoll/client";

const client = new CrawlerTollClient({ apiKey: process.env.CRAWLERTOLL_KEY! });

// 1. Discover publishers for a task.
const { publishers } = await client.discover({
  topic: "Portuguese vehicle import tax",
  minQuality: 8,
});

// 2. Query the top result.
const top = publishers[0]!;
const { result, attestation, costMicros } = await client.query({
  publisher: top.slug,
  endpoint:  "isv-calculator",
  args: {
    fuel: "diesel",
    displacement_cc: 1968,
    co2_gkm: 137,
    year: 2019,
    country_of_origin: "DE",
  },
  budgetMicros: 10_000, // refuse to send if call costs > $0.01
});

// 3. Verify provenance — fetches publisher's public key from their
//    /.well-known/context-license.json (or use the embedded demo
//    helper in v0).
import { fetchAndParse } from "@crawlertoll/parser";
const license = await fetchAndParse(`https://${top.slug}.com/.well-known/context-license.json`);
if (!license.ok) throw new Error("publisher's license file is invalid");

const verdict = await verify(attestation, license.value.attestation!.public_key_pem);
if (!verdict.valid) {
  throw new Error(`attestation invalid: ${verdict.reason} — ${verdict.detail}`);
}

console.log("verified result:", result, `(spent ${costMicros} micros)`);
```

## API

### `new CrawlerTollClient(options)`

```ts
new CrawlerTollClient({
  apiKey: string;                  // required
  baseUrl?: string;                 // default "https://api.crawlertoll.com"
  fetchImpl?: typeof fetch;         // testing / retries / proxy injection
  monthlySpendCapMicros?: number;   // default 1_000_000_000 = $1,000 / mo
});
```

### `client.discover(options?): Promise<DiscoverResult>`

Find publishers by topic, schema.org type, price, or quality. Returns:

```ts
{
  publishers: PublisherCard[];   // sorted by quality desc
  total: number;                  // matches before `limit` was applied
  demo?: true;                    // v0 only — gone once the platform ships
}
```

### `client.query<T>(options): Promise<QueryResult<T>>`

Invoke an MCP tool on a publisher's endpoint. Returns:

```ts
{
  result: T;                       // raw publisher response
  attestation: AttestationEnvelope;
  costMicros: number;
  demo?: true;                     // v0 only
}
```

Throws `CrawlerTollError` on unknown publisher, unknown endpoint, or when
the publisher's per-call price exceeds `budgetMicros`.

### `verify(envelope, publicKeyPem, options?): Promise<VerifyResult>`

Cryptographically verify a response envelope. Real Ed25519 + JCS RFC 8785
canonicalisation. Checks:

1. `magic === "ct_att_v1"`.
2. PEM decodes to a valid 32-byte Ed25519 public key.
3. Signature decodes to 64 bytes and verifies against the canonical
   signing input.
4. Envelope is within its validity window (with a 5-minute clock skew).

Returns a `VerifyResult` — never throws on signature failures. Throws
only on truly malformed envelope input.

```ts
{
  valid: true;
} | {
  valid: false;
  reason: "bad-magic" | "expired" | "future-dated" | "bad-signature" | "bad-key" | "malformed";
  detail: string;
}
```

### `signEnvelope(envelope, secretKey): Promise<AttestationEnvelope>`

Sign an envelope with a 32-byte Ed25519 secret key. Used by publisher
implementations and tests; buyer code only uses `verify()`.

### PEM helpers

```ts
import { pemToRawEd25519PublicKey, rawEd25519PublicKeyToPem } from "@crawlertoll/client";
```

Both are pure functions (no async, no crypto-subtle dependency) and work
in Node, Bun, Deno, browsers, and Cloudflare Workers.

## What this SDK does NOT do (yet)

- **Talk to a live marketplace.** v0 `discover()` and `query()` use
  bundled fixture data. The HTTP path lands when the platform Worker
  ships (per `PLATFORM_ARCHITECTURE.md`).
- **Manage API keys.** You provide one via `apiKey`. The marketplace
  hasn't issued real ones yet (week-12 milestone per `LAUNCH_DECISIONS.md`).
- **Handle x402 / OAuth 2.1 / Skyfire auth escalation.** API key auth
  is the only path in v0. The spec defines the others; SDK adds them
  alongside the live marketplace.

## What this SDK *does* do today

- **Real Ed25519 + JCS verification.** Production-ready. Verifies any
  envelope produced by `signEnvelope()` and by future real publishers.
- **PEM ↔ raw key conversion.** Matches the format `attestation.public_key_pem`
  uses in `context-license.json`.
- **Realistic-shaped fixture data.** `client.query({ publisher: "matriculix", endpoint: "isv-calculator", args: {...} })` returns a payload identical in shape to what the production endpoint will return, wrapped in a real signed envelope.
- **Demo public-key export.** Tests and notebooks can call
  `client.demoPublicKeyPem()` to confirm `verify()` accepts envelopes the
  client produced. Gone when the live backend lands.

## License

[Apache-2.0](./LICENSE). The Context License spec is CC0 1.0 — fork
the spec freely.

## Contributing

Pull requests welcome at
[`github.com/charthouse-ltd/crawlertoll-sdk-js`](https://github.com/charthouse-ltd/crawlertoll-sdk-js).

When the `crawlertoll` GitHub organisation is created (per the v0.1
launch plan), this repo moves to `github.com/crawlertoll/sdk-js`. The
npm name `@crawlertoll/client` is reserved against that move.

## Trademark

CrawlerToll™ is a trademark of Charthouse Ltd.
