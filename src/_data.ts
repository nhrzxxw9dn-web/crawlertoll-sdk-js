/**
 * Hardcoded v0 marketplace data, mirroring the publishers + sample
 * query payloads rendered by apps/web (the CrawlerToll Next.js
 * reference marketplace).
 *
 * This file goes away when the platform Worker ships and the SDK
 * starts hitting `${baseUrl}/discover` and `${baseUrl}/query` for
 * real. Until then, `client.discover()` and `client.query()` produce
 * realistic-shaped responses against this fixture so demo notebooks
 * and tests can run end-to-end without a live backend.
 */

import type { PublisherCard, AttestationEnvelope } from "./types.js";

export const PUBLISHERS: ReadonlyArray<
  PublisherCard & {
    /** Map of endpoint name → sample response payload used by the v0 stub. */
    endpoints: Record<
      string,
      { schemaOrgTypes: string[]; sampleResponse: unknown }
    >;
  }
> = [
  {
    slug: "matriculix",
    name: "Matriculix",
    description:
      "Portuguese vehicle-import regulatory engine: live ISV/IUC tables, homologação lookup, calculator, legal-change feed with provenance.",
    quality: 9.1,
    priceMicros: 5000,
    currency: "USD",
    schemaOrgTypes: ["GovernmentService", "Vehicle", "Legislation"],
    url: "https://crawlertoll.com/p/matriculix",
    endpoints: {
      "isv-calculator": {
        schemaOrgTypes: ["Action", "GovernmentService"],
        sampleResponse: {
          isv_eur: 4820.16,
          breakdown: {
            tabela_a_eur: 1421.04,
            tabela_b_eur: 5872.4,
            age_reduction_applied: 0.43,
            exemption_applied: null,
          },
          iuc_annual_estimate_eur: 215.4,
          source_provenance: {
            tables_version: "2026-01-01",
            verified_at: "2026-05-15",
          },
        },
      },
      "isv-tables": {
        schemaOrgTypes: ["Dataset"],
        sampleResponse: { year: 2026, tabela_a: [], tabela_b: [] },
      },
      homologacao: {
        schemaOrgTypes: ["Vehicle", "Dataset"],
        sampleResponse: { matches: [], total: 0 },
      },
      "legal-changes": {
        schemaOrgTypes: ["Legislation"],
        sampleResponse: { changes: [], since: "2026-04-01" },
      },
    },
  },
  {
    slug: "medxcare",
    name: "MedXcare",
    description:
      "Verified medical-tourism clinics across 12 countries with quarterly-refreshed pricing.",
    quality: 8.7,
    priceMicros: 5000,
    currency: "USD",
    schemaOrgTypes: ["MedicalClinic", "MedicalProcedure"],
    url: "https://crawlertoll.com/p/medxcare",
    endpoints: {
      clinics: {
        schemaOrgTypes: ["MedicalBusiness", "MedicalClinic"],
        sampleResponse: {
          results: [
            {
              name: "Hospital da Luz Lisboa",
              city: "Lisboa",
              jci_accredited: true,
              service_eur: 9200,
              lead_time_days: 14,
              verified_at: "2026-04-30",
            },
          ],
          total: 1,
          source_provenance: { snapshot: "2026-Q2", verified_at: "2026-05-12" },
        },
      },
      procedures: {
        schemaOrgTypes: ["MedicalProcedure"],
        sampleResponse: { procedures: [] },
      },
      destinations: {
        schemaOrgTypes: ["Place", "TouristDestination"],
        sampleResponse: { destinations: [] },
      },
    },
  },
];

/** Deterministic v0 attestation envelope generator. Used by the stub
 *  query path to produce a *real* signed envelope (against a
 *  per-process demo keypair) so callers can exercise `verify()` end
 *  to end without standing up a publisher. The demo key is *not* the
 *  real publisher key — production envelopes are signed by the
 *  publisher's actual `attestation.kid`. */
export function makeStubEnvelope(opts: {
  publisher: string;
  endpoint: string;
  requestHash: string;
  responseHash: string;
  kid: string;
}): Omit<AttestationEnvelope, "signature"> {
  const now = new Date();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  return {
    magic: "ct_att_v1",
    attestation_id: "ct_att_" + cryptoRandomHex(16),
    publisher: opts.publisher,
    endpoint: opts.endpoint,
    request_hash: opts.requestHash,
    response_hash: opts.responseHash,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ninetyDays).toISOString(),
    kid: opts.kid,
  };
}

function cryptoRandomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Fallback for older runtimes — non-cryptographic, demo data only.
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
