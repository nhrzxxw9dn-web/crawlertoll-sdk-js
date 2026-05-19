/**
 * CrawlerTollClient — the buyer-side entry point. v0 stubs `discover`
 * and `query` against the hardcoded fixture in `_data.ts`; when the
 * platform Worker ships (per docs/PLATFORM_ARCHITECTURE.md in the
 * crawlertoll spec repo), these methods route to `${baseUrl}/discover`
 * and `${baseUrl}/query/<publisher>/<endpoint>` instead.
 *
 *   const client = new CrawlerTollClient({ apiKey: process.env.CRAWLERTOLL_KEY! });
 *   const { publishers } = await client.discover({ topic: "Portuguese vehicle tax" });
 *   const { result, attestation } = await client.query({
 *     publisher: "matriculix",
 *     endpoint:  "isv-calculator",
 *     args: { fuel: "diesel", displacement_cc: 1968, ... },
 *   });
 */

import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import canonicalize from "canonicalize";

import { PUBLISHERS, makeStubEnvelope } from "./_data.js";
import { rawEd25519PublicKeyToPem } from "./pem.js";
import { signEnvelope } from "./verify.js";
import type {
  CrawlerTollClientOptions,
  DiscoverOptions,
  DiscoverResult,
  PublisherCard,
  QueryOptions,
  QueryResult,
} from "./types.js";
import { CrawlerTollError } from "./types.js";

const DEFAULT_BASE_URL = "https://api.crawlertoll.com";
const DEFAULT_SPEND_CAP = 1_000_000_000; // $1,000 / month in micros

export class CrawlerTollClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #monthlySpendCapMicros: number;

  /** Demo-mode signing keypair. Generated lazily the first time
   *  `query()` runs against the stub data so the SDK produces real
   *  Ed25519 signatures that `verify()` accepts. The matching public
   *  PEM is exposed via `demoPublisherPublicKeyPem(slug)` for tests. */
  #demoKeys?: { secretKey: Uint8Array; publicKey: Uint8Array };

  constructor(options: CrawlerTollClientOptions) {
    if (!options.apiKey) {
      throw new CrawlerTollError(
        "apiKey is required",
        "missing-api-key",
      );
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetchImpl = options.fetchImpl;
    this.#monthlySpendCapMicros =
      options.monthlySpendCapMicros ?? DEFAULT_SPEND_CAP;
  }

  /** Marketplace base URL the client targets. */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** Configured monthly hard cap (micros). */
  get monthlySpendCapMicros(): number {
    return this.#monthlySpendCapMicros;
  }

  // ─── discover() ──────────────────────────────────────────────────

  /**
   * Find publishers matching a task / topic / schema-type filter.
   *
   * v0 returns hardcoded data with `demo: true`. Replace with a real
   * call to `${baseUrl}/discover` once the platform Worker ships.
   */
  async discover(options: DiscoverOptions = {}): Promise<DiscoverResult> {
    // v0: filter the bundled fixture. Server-side semantic search
    // takes over once the platform ships.
    const topicLower = options.topic?.toLowerCase();
    let matches: PublisherCard[] = PUBLISHERS.map(stripFixtureExtras).filter((pub) => {
      if (topicLower) {
        const hay = (pub.name + " " + pub.description).toLowerCase();
        if (!hay.includes(topicLower)) {
          // Permissive: also match if any schema.org type substring matches.
          const typeMatch = pub.schemaOrgTypes.some((t) =>
            t.toLowerCase().includes(topicLower),
          );
          if (!typeMatch) return false;
        }
      }
      if (options.schemaOrgTypes && options.schemaOrgTypes.length > 0) {
        const want = new Set(options.schemaOrgTypes.map((t) => t.toLowerCase()));
        const have = new Set(pub.schemaOrgTypes.map((t) => t.toLowerCase()));
        let any = false;
        for (const w of want) if (have.has(w)) any = true;
        if (!any) return false;
      }
      if (
        typeof options.maxPriceMicros === "number" &&
        pub.priceMicros > options.maxPriceMicros
      ) {
        return false;
      }
      if (typeof options.minQuality === "number" && pub.quality < options.minQuality) {
        return false;
      }
      return true;
    });
    // Sort by quality descending — same order as the v0 marketplace home.
    matches.sort((a, b) => b.quality - a.quality);
    const total = matches.length;
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    matches = matches.slice(0, limit);
    return { publishers: matches, total, demo: true };
  }

  // ─── query() ─────────────────────────────────────────────────────

  /**
   * Invoke an MCP tool on a publisher's endpoint. v0 returns the
   * sample response payload from the bundled fixture, wrapped in a
   * real Ed25519-signed envelope. Production will replace the
   * fixture lookup with a request to `${baseUrl}/query/...`.
   */
  async query<T = unknown>(options: QueryOptions): Promise<QueryResult<T>> {
    const pub = PUBLISHERS.find((p) => p.slug === options.publisher);
    if (!pub) {
      throw new CrawlerTollError(
        `unknown publisher: "${options.publisher}"`,
        "unknown-publisher",
      );
    }
    const ep = pub.endpoints[options.endpoint];
    if (!ep) {
      throw new CrawlerTollError(
        `unknown endpoint: "${options.endpoint}" on publisher "${pub.slug}"`,
        "unknown-endpoint",
      );
    }
    if (
      typeof options.budgetMicros === "number" &&
      pub.priceMicros > options.budgetMicros
    ) {
      throw new CrawlerTollError(
        `publisher price ${pub.priceMicros} micros exceeds budget ${options.budgetMicros}`,
        "budget-exceeded",
      );
    }

    const keys = await this.#getDemoKeys();
    const requestPayload = { tool: options.endpoint, arguments: options.args };
    const requestHash = sha256Hex(canonicalize(requestPayload) ?? "");
    const responseHash = sha256Hex(canonicalize(ep.sampleResponse) ?? "");

    const unsigned = makeStubEnvelope({
      publisher: pub.slug,
      endpoint: options.endpoint,
      requestHash,
      responseHash,
      kid: `ct_sign_${pub.slug}_demo`,
    });
    const attestation = await signEnvelope(unsigned, keys.secretKey);

    return {
      result: ep.sampleResponse as T,
      attestation,
      costMicros: pub.priceMicros,
      demo: true,
    };
  }

  // ─── Demo-key utilities ──────────────────────────────────────────

  async #getDemoKeys(): Promise<{ secretKey: Uint8Array; publicKey: Uint8Array }> {
    if (!this.#demoKeys) {
      const secretKey = ed.utils.randomPrivateKey();
      const publicKey = await ed.getPublicKeyAsync(secretKey);
      this.#demoKeys = { secretKey, publicKey };
    }
    return this.#demoKeys;
  }

  /**
   * Export the public PEM corresponding to this client's demo
   * signing key. Useful in tests: pass the PEM to `verify()` to
   * confirm an envelope signed by this client's `query()` validates.
   *
   * Returns `undefined` if no `query()` call has been made yet (the
   * keypair is generated lazily).
   *
   * Removed when the SDK starts talking to a real publisher.
   */
  async demoPublicKeyPem(): Promise<string | undefined> {
    if (!this.#demoKeys) return undefined;
    return rawEd25519PublicKeyToPem(this.#demoKeys.publicKey);
  }

  /** Exposed for use when a real backend lands — currently unused. */
  protected get apiKey(): string {
    return this.#apiKey;
  }
  protected get fetchImpl(): typeof fetch | undefined {
    return this.#fetchImpl;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function stripFixtureExtras(p: (typeof PUBLISHERS)[number]): PublisherCard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { endpoints: _drop, ...card } = p;
  return card;
}

function sha256Hex(input: string): string {
  const enc = new TextEncoder();
  const hash = sha256(enc.encode(input));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}
