import { describe, expect, it } from "vitest";
import {
  analysisSchema,
  type Analysis,
  type Place,
  type Scene,
} from "@/lib/schema";
import {
  arrowFeatures,
  areaFeatureCollection,
  bearing,
  circlePolygon,
  curvedMidpoint,
  distanceKm,
  featureBounds,
  frontLineFeatureCollection,
  getScene,
  isLowConfidence,
  midpoint,
  placeAccuracyFeatureCollection,
  routeFeatureCollection,
  scenePlaces,
} from "@/lib/geo";
import fixture from "../fixtures/atlas-analysis.json";

const analysis: Analysis = analysisSchema.parse(fixture);
const scene = analysis.situation.scenes[0];

function cloneAnalysis(): Analysis {
  return structuredClone(analysis);
}

function findPlace(id: string): Place {
  const place = analysis.situation.places.find((item) => item.id === id);
  if (!place) throw new Error(`missing fixture place: ${id}`);
  return place;
}

function sceneWithoutFeatures(): Scene {
  return {
    ...scene,
    placeIds: [],
    routeIds: [],
    areaIds: [],
    frontLineIds: [],
  };
}

describe("atlas fixture", () => {
  it("matches the frozen analysis schema", () => {
    expect(analysis.situation.places).toHaveLength(3);
    expect(analysis.situation.routes).toHaveLength(2);
    expect(analysis.situation.scenes).toHaveLength(1);
    expect(getScene(analysis, 0)?.id).toBe("scene-advance");
  });
});

describe("featureBounds", () => {
  it("returns the union of places, routes, areas and front lines", () => {
    expect(featureBounds(analysis, 0)).toEqual([111.9, 29.5, 113.9, 30.6]);
  });

  it("returns null when the scene has nothing drawable", () => {
    const empty = cloneAnalysis();
    empty.situation.scenes = [sceneWithoutFeatures()];
    expect(featureBounds(empty, 0)).toBeNull();
  });

  it("falls back to every located feature when there is no scene", () => {
    const noScenes = cloneAnalysis();
    noScenes.situation.scenes = [];
    expect(featureBounds(noScenes, 0)).toEqual([111.9, 29.5, 113.9, 30.6]);
  });

  it("treats an out-of-range scene index as the full overview", () => {
    expect(featureBounds(analysis, 99)).toEqual([111.9, 29.5, 113.9, 30.6]);
  });
});

describe("scene filtering", () => {
  it("only returns located places referenced by the scene", () => {
    const onlyChibi: Scene = {
      ...scene,
      placeIds: ["place-chibi"],
      routeIds: [],
      areaIds: [],
      frontLineIds: [],
    };
    expect(scenePlaces(analysis, onlyChibi).map((place) => place.id)).toEqual([
      "place-chibi",
    ]);
    expect(scenePlaces(analysis, null).map((place) => place.id)).toEqual([
      "place-jiangling",
      "place-chibi",
    ]);
  });

  it("only builds route features for routes listed in the scene", () => {
    const oneRoute: Scene = { ...scene, routeIds: ["route-advance"] };
    const collection = routeFeatureCollection(analysis, oneRoute);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.id).toBe("route-advance");
    expect(collection.features[0].properties.color).toBe("#9b2c2c");
    const coordinates = collection.features[0].geometry.coordinates;
    expect(coordinates.length).toBeGreaterThan(2);
    expect(coordinates[0]).toEqual([112.19, 30.35]);
    expect(coordinates[coordinates.length - 1]).toEqual([113.9, 29.72]);
    expect(collection.features[0].properties.effect).toBe("march");
    expect(coordinates[Math.floor(coordinates.length / 2)]).not.toEqual([
      112.19 + (113.9 - 112.19) / 2,
      30.35 + (29.72 - 30.35) / 2,
    ]);
  });

  it("skips routes whose endpoints cannot be located", () => {
    const places = analysis.situation.places.filter(
      (place) => place.id !== "place-chibi",
    );
    const collection = routeFeatureCollection(
      { ...analysis, situation: { ...analysis.situation, places } },
      scene,
    );
    expect(collection.features).toHaveLength(0);
  });
});

describe("area and front line collections", () => {
  it("carries faction colours for control areas", () => {
    const collection = areaFeatureCollection(analysis, scene);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.name).toBe("曹军控制区（示意）");
    expect(collection.features[0].properties.color).toBe("#9b2c2c");
    expect(collection.features[0].geometry.type).toBe("Polygon");
  });

  it("uses the schematic dashed front line geometry", () => {
    const collection = frontLineFeatureCollection(analysis, scene);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.factionIds).toEqual([
      "faction-cao",
      "faction-sunliu",
    ]);
    expect(collection.features[0].geometry.coordinates).toHaveLength(3);
  });
});

describe("arrowFeatures", () => {
  it("emits one midpoint arrow per route with located endpoints", () => {
    const collection = arrowFeatures(
      analysis.situation.routes,
      analysis.situation.places,
      analysis.situation.factions,
    );
    expect(collection.features).toHaveLength(2);
    const advance = collection.features.find(
      (feature) => feature.properties.id === "route-advance",
    );
    expect(advance).toBeDefined();
    expect(advance?.geometry.type).toBe("Point");
    expect(advance?.properties.angle).toBeCloseTo(
      curvedMidpoint([112.19, 30.35], [113.9, 29.72], "route-advance").angle,
      6,
    );
    expect(advance?.properties.color).toBe("#9b2c2c");
  });

  it("drops arrows when an endpoint has no location", () => {
    const locatedOnly = analysis.situation.places.filter(
      (place) => place.location,
    );
    const collection = arrowFeatures(
      analysis.situation.routes,
      locatedOnly,
      analysis.situation.factions,
    );
    expect(collection.features).toHaveLength(2);

    const noChibi = analysis.situation.places.filter(
      (place) => place.id !== "place-chibi",
    );
    expect(
      arrowFeatures(analysis.situation.routes, noChibi).features,
    ).toHaveLength(0);
  });
});

describe("confidence", () => {
  it("flags low-confidence and unresolved places", () => {
    expect(isLowConfidence(findPlace("place-chibi"))).toBe(true);
    expect(isLowConfidence(findPlace("place-jiangling"))).toBe(false);
    expect(isLowConfidence(findPlace("place-huarong"))).toBe(true);
  });

  it("renders dashed rings for low-confidence or coarse locations only", () => {
    const collection = placeAccuracyFeatureCollection(analysis, scene);
    expect(collection.features.map((feature) => feature.properties.id)).toEqual(
      ["place-jiangling", "place-chibi"],
    );
    expect(collection.features[0].geometry.type).toBe("Polygon");
    expect(collection.features[0].properties.radiusKm).toBe(30);

    const confident = cloneAnalysis();
    const chibi = confident.situation.places.find(
      (place) => place.id === "place-chibi",
    );
    if (!chibi?.location) throw new Error("fixture changed");
    chibi.location.confidence = 0.95;
    chibi.location.precision = "site";
    chibi.location.radiusKm = 3;
    const filtered = placeAccuracyFeatureCollection(confident, scene);
    expect(filtered.features.map((feature) => feature.properties.id)).toEqual([
      "place-jiangling",
    ]);
  });
});

describe("geometry helpers", () => {
  it("computes distance, midpoint and normalised bearing", () => {
    expect(distanceKm([0, 0], [0, 1])).toBeCloseTo(111.19, 1);
    expect(distanceKm({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeCloseTo(
      111.19,
      1,
    );

    const center = midpoint([0, 0], [2, 0]);
    expect(center[0]).toBeCloseTo(1, 6);
    expect(center[1]).toBeCloseTo(0, 6);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 4);
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 4);
    expect(bearing([0, 0], [-1, 0])).toBeCloseTo(270, 4);
  });

  it("builds a closed circle polygon with the requested radius", () => {
    const polygon = circlePolygon([116, 39], 30, 16);
    expect(polygon.geometry.type).toBe("Polygon");
    const ring = polygon.geometry.coordinates[0];
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const edgeDistance = distanceKm([116, 39], [ring[0][0], ring[0][1]]);
    expect(edgeDistance).toBeCloseTo(30, 0);
  });
});
