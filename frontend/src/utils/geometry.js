// Shared geometry helpers used by both the 2D floor-plan editor and the
// 3D scene, so the two views always agree on where things are.

export const SCALE = 0.05;
export const ORIGIN_X = 400;
export const ORIGIN_Y = 300;

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

export function toWorld(px, py) {
  return {
    x: (px - ORIGIN_X) * SCALE,
    z: (py - ORIGIN_Y) * SCALE,
  };
}

export function toPlan(x, z) {
  return {
    x: x / SCALE + ORIGIN_X,
    y: z / SCALE + ORIGIN_Y,
  };
}