// Shared factories/defaults for building elements (pillars, floors) and
// for migrating older single-floor projects into the multi-floor shape.
// Sits alongside utils/openings.js, which owns door/window/vent sizing.

export const PILLAR_DEFAULTS = { radius: 15, shape: 'round', height: 250, bottomOffset: 0 };
export const DEFAULT_WALL_HEIGHT = 250;

let counter = 0;
export function makeId() {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}`;
}

export function createFloor(name, index) {
  return {
    id: makeId(),
    name: name || `Floor ${index + 1}`,
    wallHeight: DEFAULT_WALL_HEIGHT,
    roof: 'none', // 'none' | 'flat' | 'hip'
    ceiling: false,
  };
}

export function createPillar(x, y, floorId, wallHeight) {
  return {
    id: makeId(),
    type: 'pillar',
    floorId,
    x,
    y,
    radius: PILLAR_DEFAULTS.radius,
    shape: PILLAR_DEFAULTS.shape,
    height: wallHeight || PILLAR_DEFAULTS.height,
    bottomOffset: 0,
  };
}

// Given floors in stacking order (index 0 = ground), returns each
// floor's elevation: the world Y offset in cm, equal to the summed
// wallHeight of every floor stacked below it.
export function computeFloorElevations(floors) {
  const elevations = {};
  let cursor = 0;
  floors.forEach((f) => {
    elevations[f.id] = cursor;
    cursor += f.wallHeight || DEFAULT_WALL_HEIGHT;
  });
  return elevations;
}

// Normalizes a project's `design` blob (loaded from the API) into the
// current multi-floor shape: { floors: [...], elements: [...] }.
// Projects saved before multi-floor support stored a flat
// `design.walls` array with no floor concept at all -- those all
// become a single "Ground Floor" so nothing existing breaks.
export function normalizeDesign(design) {
  if (design && Array.isArray(design.floors) && Array.isArray(design.elements)) {
    return design;
  }
  const legacyWalls = Array.isArray(design?.walls) ? design.walls : [];
  const floor = createFloor('Ground Floor', 0);
  const elements = legacyWalls.map((w) => ({ ...w, floorId: floor.id }));
  return { floors: [floor], elements };
}
