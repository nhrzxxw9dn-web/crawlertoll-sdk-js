/**
 * @crawlertoll/client — buyer-side TypeScript types.
 *
 * Covers three concerns: client configuration, discovery (find
 * publishers), query (invoke an MCP tool on a publisher), and the
 * signed attestation envelope returned with every response.
 *
 * Spec: https://crawlertoll.com/docs/sdk · attestation companion spec
 * forthcoming. Envelope shape v1.0 frozen.
 */

// ─── Client config ─────────────────────────────────────────────────

export interface CrawlerTollClientOptions {
  /** Buyer-side API key issued by the CrawlerToll marketplace. */
  apiKey: string;
  /** Default: `https://api.crawlertoll.com`. Override for staging
   *  or to point at a private deployment. */
  baseUrl?: string;
  /** Custom fetch implementation (testing, retries, proxies). */
  fetchImpl?: typeof fetch;
  /** Default hard spend cap, in micros (1 micro = 10⁻⁶ unit of currency).
   *  Server-side enforced; client also bails before sending if the
   *  per-call estimate exceeds the remainder. Default: 1_000_000_000
   *  micros = $1,000 / month. */
  monthlySpendCapMicros?: number;
}

// ─── Discovery ──────────────────────────────────────────────────────

export interface DiscoverOptions {
  /** Free-text task / topic — matched against publisher descriptions
   *  and endpoint descriptions via embedding similarity (server-side). */
  topic?: string;
  /** Filter by Schema.org type names served by the endpoint. */
  schemaOrgTypes?: string[];
  /** Reject publishers whose unit price exceeds this in micros. */
  maxPriceMicros?: number;
  /** Reject publishers below this composite quality score (0-10). */
  minQuality?: number;
  /** Result cap. Default 20, max 100. */
  limit?: number;
}

export interface PublisherCard {
  slug: string;
  name: string;
  description: string;
  /** Composite quality score, 0-10. */
  quality: number;
  /** Unit price in micros. */
  priceMicros: number;
  /** Currency for `priceMicros`. */
  currency: "USD" | "USDC" | "GBP" | "EUR";
  /** Schema.org type names this publisher serves. */
  schemaOrgTypes: string[];
  /** Marketplace listing URL. */
  url: string;
}

export interface DiscoverResult {
  publishers: PublisherCard[];
  /** Total matches before `limit` was applied. */
  total: number;
  /** Set when running against the v0 stub data. Removed once the
   *  marketplace registry endpoint is live. */
  demo?: true;
}

// ─── Query ──────────────────────────────────────────────────────────

export interface QueryOptions {
  /** Publisher slug, e.g. `"matriculix"`. */
  publisher: string;
  /** Endpoint name, e.g. `"isv-calculator"`. */
  endpoint: string;
  /** Tool arguments — passed through to the publisher's MCP server. */
  args: Record<string, unknown>;
  /** Per-call hard ceiling in micros. The client refuses to send if the
   *  publisher's price chip exceeds this. */
  budgetMicros?: number;
}

export interface QueryResult<T = unknown> {
  /** Raw publisher response. */
  result: T;
  /** Signed envelope — pass to `verify()` to confirm provenance. */
  attestation: AttestationEnvelope;
  /** What this call cost the buyer, in micros. */
  costMicros: number;
  /** Set when running against the v0 stub data. Removed once the
   *  platform Worker is live. */
  demo?: true;
}

// ─── Attestation envelope ──────────────────────────────────────────

/**
 * Signed response envelope. Every call returns one. The signature
 * covers a canonical (JCS RFC 8785) serialization of every field
 * EXCEPT `signature` itself.
 *
 * Signing scheme: Ed25519 over the canonical JSON bytes, prefixed
 * with the magic constant `"ct_att_v1"` to bind the signature to
 * this envelope shape (domain separation).
 */
export interface AttestationEnvelope {
  /** Domain-separator magic. MUST be `"ct_att_v1"` for v1 envelopes. */
  magic: "ct_att_v1";
  /** Unique envelope identifier — appears in `/audit/<id>` URLs. */
  attestation_id: string;
  /** Publisher slug. */
  publisher: string;
  /** Endpoint name. */
  endpoint: string;
  /** Lowercased hex SHA-256 of the canonical request payload. */
  request_hash: string;
  /** Lowercased hex SHA-256 of the canonical response payload. */
  response_hash: string;
  /** Envelope issuance time, ISO-8601 UTC. */
  issued_at: string;
  /** Envelope expiry, ISO-8601 UTC. Default: issued_at + 90 days. */
  expires_at: string;
  /** Signing key id — matches `attestation.kid` in the publisher's
   *  context-license.json. */
  kid: string;
  /** Base64-encoded 64-byte Ed25519 signature. */
  signature: string;
}

// ─── Verification result ───────────────────────────────────────────

export interface VerifyResult {
  /** Cryptographic + temporal verdict. */
  valid: boolean;
  /** When `valid === false`, a short reason code. */
  reason?:
    | "bad-magic"
    | "expired"
    | "future-dated"
    | "bad-signature"
    | "bad-key"
    | "malformed";
  /** Human-readable explanation, suitable for logs. */
  detail?: string;
}

// ─── Errors ────────────────────────────────────────────────────────

export class CrawlerTollError extends Error {
  override readonly name = "CrawlerTollError";
  readonly code: string;
  override readonly cause?: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}
