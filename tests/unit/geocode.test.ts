import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { resolveMentions } from "@/lib/gazetteer";
import { parseModelGeocodes } from "@/lib/pipeline/model-draft";

describe("model-first geocoding", () => {
  it("parses approximate model coordinates and modern addresses", () => {
    const parsed = parseModelGeocodes({
      locations: [
        {
          name: "瓜州",
          modernName: "甘肃省酒泉市瓜州县",
          lat: 40.52,
          lng: 95.78,
          precision: "county",
          confidence: 0.85,
          reason: "明初瓜州指今甘肃瓜州县，不是江西同名地名",
        },
      ],
    });
    expect(parsed.sawLocationsArray).toBe(true);
    expect(parsed.locations[0]).toMatchObject({
      name: "瓜州",
      lat: 40.52,
      lng: 95.78,
      precision: "county",
      confidence: 0.85,
    });
  });

  it("uses the model location instead of a same-name gazetteer entry", async () => {
    const [resolved] = await resolveMentions({
      mentions: [
        {
          name: "瓜州",
          modelLocation: {
            lat: 40.52,
            lng: 95.78,
            precision: "county",
            confidence: 0.85,
            modernName: "甘肃省酒泉市瓜州县",
            reason: "明初瓜州指今甘肃瓜州县，不是江西同名地名",
          },
        },
      ],
      gazetteer: { ancient: [], modern: [], dynasties: [] },
    });
    expect(resolved?.source).toBe("model");
    expect(resolved?.location?.source).toBe("model");
    expect(resolved?.location?.lat).toBeCloseTo(40.52, 4);
    expect(resolved?.location?.lng).toBeCloseTo(95.78, 4);
    expect(resolved?.locationNote).toContain("不是江西同名地名");
  });
});
