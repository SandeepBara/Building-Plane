// Single source of truth for door/window/vent sizing, shared by the 2D
// editor (FloorPlanEditor2D) and the 3D scene (Scene3D) so an opening
// placed in either view behaves identically, and so different opening
// types on the same wall don't collide.
//
// Values are in the same "cm" unit used elsewhere for wall height, and
// are chosen so that, on a standard 250cm wall, doors/windows/vents
// occupy non-overlapping vertical bands:
//   door:   0   - 210  (floor to lintel)
//   window: 90  - 210  (sill to lintel)
//   vent:   215 - 245  (near the ceiling)
export const OPENING_DEFAULTS = {
  door: { width: 90, height: 210, bottomOffset: 0 },
  window: { width: 110, height: 120, bottomOffset: 90 },
  vent: { width: 50, height: 30, bottomOffset: 215 },
};

export function getOpeningDefaults(type) {
  return OPENING_DEFAULTS[type] || OPENING_DEFAULTS.window;
}
