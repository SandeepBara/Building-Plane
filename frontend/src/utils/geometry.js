// Shared geometry helpers used by both the 2D floor-plan editor and the
// 3D scene, so the two views always agree on where things are.

// Scale factor + origin used to convert 2D canvas pixel coordinates into
// the 3D world used by Scene3D. Keeping these in one place means the 2D
// editor and 3D view can never drift out of sync.
export const SCALE = 0.05;
export const ORIGIN_X = 400;
export const ORIGIN_Y = 300;

// Projects point (px,py) onto the segment (x1,y1)-(x2,y2).
// Returns { t, x, y, distSq } where t is clamped to [0,1] (the closest
// point on the segment, not the infinite line) and (x,y) is that point.
export function projectPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  const distSq = (px - x) * (px - x) + (py - y) * (py - y);
  return { t, x, y, distSq };
}

export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const { distSq } = projectPointOnSegment(px, py, x1, y1, x2, y2);
  return Math.sqrt(distSq);
}

// 2D floor-plan pixel coords -> 3D world coords (x/z plane, y is up).
export function toWorld(px, py) {
  return {
    x: (px - ORIGIN_X) * SCALE,
    z: (py - ORIGIN_Y) * SCALE,
  };
}

// 3D world x/z -> 2D floor-plan pixel coords (inverse of toWorld).
export function toPlan(x, z) {
  return {
    x: x / SCALE + ORIGIN_X,
    y: z / SCALE + ORIGIN_Y,
  };
}
