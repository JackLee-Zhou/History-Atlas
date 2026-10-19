import { describe, expect, it } from "vitest";
import {
  MAP_EFFECTS,
  curvedLine,
  placeEffect,
  routeEffect,
} from "@/lib/geo";
import type { Place } from "@/lib/schema";

function place(partial: Partial<Place>): Place {
  return {
    id: "p1",
    name: "某地",
    category: "city",
    evidence: ["c1"],
    ...partial,
  } as Place;
}

describe("atlas effect library", () => {
  it("maps route kinds to distinct line effects", () => {
    expect(routeEffect("advance").kind).toBe("march");
    expect(routeEffect("retreat").kind).toBe("retreat");
    expect(routeEffect("reinforce").kind).toBe("reinforce");
    expect(routeEffect("transport").kind).toBe("transport");
    expect(MAP_EFFECTS.march.dash).toBeUndefined();
    expect(MAP_EFFECTS.retreat.dash).toEqual([2, 2]);
  });

  it("maps battlefield, siege, ambush and camp places to pulse/glyph effects", () => {
    expect(placeEffect(place({ category: "battlefield" })).kind).toBe("battle");
    expect(placeEffect(place({ role: "围城打援" })).kind).toBe("siege");
    expect(placeEffect(place({ role: "设伏" })).kind).toBe("ambush");
    expect(placeEffect(place({ category: "camp" })).kind).toBe("camp");
    expect(placeEffect(place({ category: "pass" })).kind).toBe("pass");
  });

  it("curves routes but keeps both endpoints exact", () => {
    const line = curvedLine([110, 30], [120, 36], "r1");
    expect(line[0]).toEqual([110, 30]);
    expect(line[line.length - 1]).toEqual([120, 36]);
    const middle = line[Math.floor(line.length / 2)]!;
    expect(middle[1]).not.toBe(33);
  });
});
