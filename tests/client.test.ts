import { describe, it, expect } from "vitest";
import { CrawlerTollClient, verify, CrawlerTollError } from "../src/index.js";

function newClient() {
  return new CrawlerTollClient({ apiKey: "ct_test_abc123" });
}

describe("CrawlerTollClient construction", () => {
  it("rejects missing apiKey", () => {
    expect(() => new CrawlerTollClient({ apiKey: "" })).toThrow(CrawlerTollError);
  });

  it("defaults baseUrl to https://api.crawlertoll.com", () => {
    expect(newClient().baseUrl).toBe("https://api.crawlertoll.com");
  });

  it("honours a custom baseUrl", () => {
    const c = new CrawlerTollClient({
      apiKey: "k",
      baseUrl: "https://staging.crawlertoll.com",
    });
    expect(c.baseUrl).toBe("https://staging.crawlertoll.com");
  });

  it("defaults monthly spend cap to $1,000 (1B micros)", () => {
    expect(newClient().monthlySpendCapMicros).toBe(1_000_000_000);
  });
});

describe("discover()", () => {
  it("returns both bundled publishers with no filters", async () => {
    const r = await newClient().discover();
    expect(r.publishers.length).toBeGreaterThanOrEqual(2);
    expect(r.demo).toBe(true);
  });

  it("sorts by quality descending", async () => {
    const r = await newClient().discover();
    for (let i = 1; i < r.publishers.length; i++) {
      expect(r.publishers[i - 1]!.quality).toBeGreaterThanOrEqual(
        r.publishers[i]!.quality,
      );
    }
  });

  it("filters by topic against publisher description", async () => {
    const r = await newClient().discover({ topic: "vehicle" });
    expect(r.publishers.some((p) => p.slug === "matriculix")).toBe(true);
    expect(r.publishers.some((p) => p.slug === "medxcare")).toBe(false);
  });

  it("filters by schema.org type", async () => {
    const r = await newClient().discover({ schemaOrgTypes: ["MedicalClinic"] });
    expect(r.publishers.length).toBe(1);
    expect(r.publishers[0]?.slug).toBe("medxcare");
  });

  it("filters by maxPriceMicros", async () => {
    const r = await newClient().discover({ maxPriceMicros: 1 });
    expect(r.publishers).toHaveLength(0);
  });

  it("filters by minQuality", async () => {
    const r = await newClient().discover({ minQuality: 9 });
    expect(r.publishers.every((p) => p.quality >= 9)).toBe(true);
    expect(r.publishers.some((p) => p.slug === "matriculix")).toBe(true);
  });

  it("clamps the limit to [1, 100]", async () => {
    const r1 = await newClient().discover({ limit: 0 });
    expect(r1.publishers.length).toBeGreaterThanOrEqual(1);
    const r2 = await newClient().discover({ limit: 10000 });
    expect(r2.publishers.length).toBeLessThanOrEqual(100);
  });
});

describe("query()", () => {
  it("returns a sample response + a real Ed25519-signed envelope", async () => {
    const client = newClient();
    const r = await client.query({
      publisher: "matriculix",
      endpoint: "isv-calculator",
      args: {
        fuel: "diesel",
        displacement_cc: 1968,
        co2_gkm: 137,
        year: 2019,
        country_of_origin: "DE",
      },
    });
    expect(r.demo).toBe(true);
    expect(r.costMicros).toBe(5000);
    expect(r.attestation.magic).toBe("ct_att_v1");
    expect(r.attestation.publisher).toBe("matriculix");
    expect(r.attestation.endpoint).toBe("isv-calculator");
    expect(r.attestation.signature.length).toBeGreaterThan(0);

    const pem = await client.demoPublicKeyPem();
    expect(pem).toBeDefined();
    const verdict = await verify(r.attestation, pem!);
    expect(verdict.valid).toBe(true);

    type IsvResp = { isv_eur: number };
    const result = r.result as IsvResp;
    expect(result.isv_eur).toBeGreaterThan(0);
  });

  it("throws on unknown publisher", async () => {
    await expect(
      newClient().query({ publisher: "nope", endpoint: "x", args: {} }),
    ).rejects.toThrow(/unknown publisher/);
  });

  it("throws on unknown endpoint", async () => {
    await expect(
      newClient().query({
        publisher: "matriculix",
        endpoint: "nope",
        args: {},
      }),
    ).rejects.toThrow(/unknown endpoint/);
  });

  it("throws when publisher price exceeds budgetMicros", async () => {
    await expect(
      newClient().query({
        publisher: "matriculix",
        endpoint: "isv-calculator",
        args: {},
        budgetMicros: 1,
      }),
    ).rejects.toThrow(/budget/);
  });

  it("re-uses the same demo keypair across queries", async () => {
    const client = newClient();
    await client.query({ publisher: "matriculix", endpoint: "isv-tables", args: {} });
    const pem1 = await client.demoPublicKeyPem();
    await client.query({ publisher: "medxcare", endpoint: "clinics", args: {} });
    const pem2 = await client.demoPublicKeyPem();
    expect(pem1).toBe(pem2);
  });
});
