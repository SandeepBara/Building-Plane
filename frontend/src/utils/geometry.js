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

// ---------------------------------------------------------------------
// Curved walls
// ---------------------------------------------------------------------
// A curved wall keeps its two endpoints (x1,y1)-(x2,y2) as the source of
// truth (so selection, length display, opening-anchoring math etc. that
// already work off endpoints keep working) and adds a single extra
// number, `bow`: the perpendicular distance (in plan px) from the
// straight chord between the endpoints to where the curve actually
// bulges out to at its midpoint. bow === 0 (or curved !== true) means a
// plain straight wall -- so this is a strict superset of the old model.
//
// We render the curve as a quadratic Bezier. The Bezier control point
// has to be placed at 2x the desired midpoint offset, because a
// quadratic curve's own midpoint is B(0.5) = P0/4 + P1/2 + P2/4, i.e.
// only half of the control point's offset from the chord shows up at
// the curve's midpoint.
export function curveControlPoint(x1, y1, x2, y2, bow) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  if (!bow) return { x: mx, y: my };
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return { x: mx + nx * bow * 2, y: my + ny * bow * 2 };
}

export function pointOnQuadratic(x1, y1, cx, cy, x2, y2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
    y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
  };
}

// Returns the wall's actual curve midpoint in plan space -- used to
// position the draggable "bulge" handle in the 2D editor.
export function wallCurveMidpoint(wall) {
  const { x: cx, y: cy } = curveControlPoint(wall.x1, wall.y1, wall.x2, wall.y2, wall.bow || 0);
  return pointOnQuadratic(wall.x1, wall.y1, cx, cy, wall.x2, wall.y2, 0.5);
}

// Samples a wall (straight or curved) into an ordered polyline of plan
// points. Straight walls are just their two endpoints; curved walls are
// subdivided into `segments` short chords. Both the 2D hit-testing/
// drawing code and the 3D extruder walk this same polyline, so they
// always agree on the wall's shape.
export function sampleWallPath(wall, segments = 16) {
  if (!wall.curved || !wall.bow) {
    return [
      { x: wall.x1, y: wall.y1 },
      { x: wall.x2, y: wall.y2 },
    ];
  }
  const { x: cx, y: cy } = curveControlPoint(wall.x1, wall.y1, wall.x2, wall.y2, wall.bow);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(pointOnQuadratic(wall.x1, wall.y1, cx, cy, wall.x2, wall.y2, i / segments));
  }
  return pts;
}

// Distance from a point to a wall's actual path (straight or curved).
// Used for 2D click/hover hit-testing so curved walls are selectable
// along their real curve, not just their straight chord.
export function distanceToWallPath(px, py, wall) {
  const pts = sampleWallPath(wall, wall.curved && wall.bow ? 16 : 1);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distanceToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------
// Convex hull + centroid
// ---------------------------------------------------------------------
// Used to auto-derive a floor's roof/ceiling footprint from the plan
// points of its walls. This is a deliberate simplification: it wraps
// the OUTER extent of a floor's walls rather than reconstructing exact
// room polygons, which would require graph-tracing every wall loop
// (nontrivial for arbitrary, possibly-disconnected wall layouts). For
// rectangular/L-shaped buildings the hull matches the real outline
// exactly; for very concave (U/H-shaped) footprints, the roof will
// bridge over the concave notch rather than following it in. Good
// enough for an auto-generated first pass.
export function convexHull(points) {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

export function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  points.forEach((p) => {
    x += p.x;
    y += p.y;
  });
  return { x: x / points.length, y: y / points.length };
}
