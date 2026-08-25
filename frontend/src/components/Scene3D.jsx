import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  SCALE,
  toWorld,
  toPlan,
  projectPointOnSegment,
  sampleWallPath,
  convexHull,
  polygonCentroid,
} from '../utils/geometry.js';
import { OPENING_DEFAULTS as TOOL_DEFAULTS } from '../utils/openings.js';
import { createPillar } from '../utils/elements.js';

const ELEMENT_COLORS_3D = {
  door: '#8B4513',
  vent: '#ff8c00',
};

const SELECTED_COLOR = '#007bff';
const GHOST_OPACITY = 0.32;
// TOOL_DEFAULTS (door/window/vent width/height/bottomOffset) now comes
// from utils/openings.js, the single shared source used by both the 2D
// editor and this 3D scene, so an opening placed in either view has the
// same size and sits in the same vertical band on the wall.

function wallWorldPoints(wall) {
  return { start: toWorld(wall.x1, wall.y1), end: toWorld(wall.x2, wall.y2) };
}

// Cuts door/window/vent-shaped holes out of a STRAIGHT wall and returns
// the remaining solid wall pieces as { uStart, uEnd, yStart, yEnd } boxes
// (u = position along the wall 0..1, y = height in world units).
//
// This handles any number of openings on the same wall, including ones
// whose horizontal (u) ranges overlap -- e.g. a window and a vent
// placed near the same spot on a wall. Rather than cutting each
// opening independently (which produced duplicated/overlapping wall
// geometry when two openings shared horizontal space), it slices the
// wall into vertical "columns" at every opening edge, merges the
// vertical ranges of whichever openings cover each column, and emits
// only the solid (non-open) leftover per column.
//
// Curved walls don't go through this -- openings aren't supported on
// them (see buildCurvedBoxes below), so they're always returned as one
// full-height, unbroken run of boxes along the sampled curve.
function buildWallSegments(wall, openings) {
  const H = (wall.height || 250) * SCALE;
  const { start, end } = wallWorldPoints(wall);
  const wallLength3D = Math.hypot(end.x - start.x, end.z - start.z);
  if (wallLength3D === 0) return [];

  const EPS = 1e-4;

  const spans = openings
    .map((o) => {
      const p1 = projectPointOnSegment(o.x1, o.y1, wall.x1, wall.y1, wall.x2, wall.y2);
      const p2 = projectPointOnSegment(o.x2, o.y2, wall.x1, wall.y1, wall.x2, wall.y2);
      const uStart = Math.min(p1.t, p2.t);
      const uEnd = Math.max(p1.t, p2.t);
      if (uEnd - uStart < 0.001) return null;
      const bottom = Math.max(0, (o.bottomOffset || 0) * SCALE);
      const top = Math.min(bottom + (o.height || 0) * SCALE, H);
      if (top - bottom < 0.001) return null;
      return { uStart, uEnd, bottom, top };
    })
    .filter(Boolean);

  if (spans.length === 0) {
    return [{ uStart: 0, uEnd: 1, yStart: 0, yEnd: H }];
  }

  // Column breakpoints along the wall, from every opening edge plus
  // the wall's own start/end.
  const breakpoints = Array.from(new Set([0, 1, ...spans.flatMap((s) => [s.uStart, s.uEnd])])).sort(
    (a, b) => a - b
  );

  const segments = [];

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const colStart = breakpoints[i];
    const colEnd = breakpoints[i + 1];
    if (colEnd - colStart < EPS) continue;
    const colMid = (colStart + colEnd) / 2;

    // Openings whose horizontal range fully covers this column.
    const covering = spans.filter((s) => s.uStart <= colMid && s.uEnd >= colMid);

    // Merge covering openings' vertical ranges into sorted,
    // non-overlapping intervals (handles a window + vent that share
    // horizontal space but not vertical space, or that overlap both).
    const openRanges = covering
      .map((s) => [s.bottom, s.top])
      .sort((a, b) => a[0] - b[0])
      .reduce((merged, [b, t]) => {
        if (merged.length && b <= merged[merged.length - 1][1] + EPS) {
          merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], t);
        } else {
          merged.push([b, t]);
        }
        return merged;
      }, []);

    // Solid wall = complement of the merged open ranges within [0, H].
    let cursorY = 0;
    openRanges.forEach(([b, t]) => {
      if (b > cursorY + EPS) {
        segments.push({ uStart: colStart, uEnd: colEnd, yStart: cursorY, yEnd: b });
      }
      cursorY = Math.max(cursorY, t);
    });
    if (H - cursorY > EPS) {
      segments.push({ uStart: colStart, uEnd: colEnd, yStart: cursorY, yEnd: H });
    }
  }

  return segments;
}

// Builds a list of box descriptors { position, rotationY, size } for a
// wall's 3D geometry, whether it's straight (with opening holes cut in,
// via buildWallSegments) or curved (a run of full-height boxes along
// the sampled curve, no opening cuts).
function buildWallBoxes(wall, openings) {
  const H = (wall.height || 250) * SCALE;
  const isCurved = (wall.type || 'wall') === 'wall' && wall.curved && wall.bow;

  if (isCurved) {
    const pts = sampleWallPath(wall, 16);
    const boxes = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = toWorld(pts[i].x, pts[i].y);
      const b = toWorld(pts[i + 1].x, pts[i + 1].y);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length <= 0.001) continue;
      const angle = Math.atan2(b.z - a.z, b.x - a.x);
      boxes.push({
        position: [(a.x + b.x) / 2, H / 2, (a.z + b.z) / 2],
        rotationY: -angle,
        size: [length, H, 0.2],
      });
    }
    return boxes;
  }

  const segs = buildWallSegments(wall, openings);
  const { start, end } = wallWorldPoints(wall);
  const wallLength3D = Math.hypot(end.x - start.x, end.z - start.z);
  const angle = Math.atan2(end.z - start.z, end.x - start.x);
  return segs
    .map((seg) => {
      const uMid = (seg.uStart + seg.uEnd) / 2;
      const segLength = (seg.uEnd - seg.uStart) * wallLength3D;
      const segHeight = seg.yEnd - seg.yStart;
      const cx = start.x + uMid * (end.x - start.x);
      const cz = start.z + uMid * (end.z - start.z);
      const cy = (seg.yStart + seg.yEnd) / 2;
      return { position: [cx, cy, cz], rotationY: -angle, size: [segLength, segHeight, 0.2] };
    })
    .filter((b) => b.size[0] > 0.001 && b.size[1] > 0.001);
}

function Wall3D({ wall, openings, isSelected, onWallClick, onWallPointerDown, ghost = false }) {
  const boxes = useMemo(() => buildWallBoxes(wall, openings), [wall, openings]);
  const color = isSelected ? SELECTED_COLOR : ghost ? '#6b7280' : '#d1d5db';

  return (
    <group>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={b.position}
          rotation={[0, b.rotationY, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            onWallPointerDown(wall);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onWallClick(wall, e.point);
          }}
        >
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={color} roughness={0.4} transparent={ghost} opacity={ghost ? GHOST_OPACITY : 1} />
        </mesh>
      ))}
    </group>
  );
}

function OpeningElement({ item, isSelected, onItemClick, onItemPointerDown, ghost = false }) {
  const dx = item.x2 - item.x1;
  const dz = item.y2 - item.y1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const { x: cx, z: cz } = toWorld((item.x1 + item.x2) / 2, (item.y1 + item.y2) / 2);
  const height = (item.height || 0) * SCALE;
  const bottomOffset = (item.bottomOffset || 0) * SCALE;
  const wallLength = length * SCALE;
  const cy = bottomOffset + height / 2;
  const opacity = ghost ? GHOST_OPACITY : 1;

  const handleClick = (e) => {
    e.stopPropagation();
    onItemClick(item);
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
    onItemPointerDown(item);
  };

  if (item.type === 'door') {
    const doorColor = isSelected ? SELECTED_COLOR : ghost ? '#6b7280' : ELEMENT_COLORS_3D.door;
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.12]} />
          <meshStandardMaterial color={doorColor} roughness={0.3} transparent={ghost} opacity={opacity} />
        </mesh>
        {!ghost && (
          <mesh position={[wallLength * 0.35, 0, 0.08]}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshStandardMaterial color="#ffd700" metalness={0.8} />
          </mesh>
        )}
      </group>
    );
  }

  if (item.type === 'window') {
    const frameColor = isSelected ? SELECTED_COLOR : ghost ? '#6b7280' : '#1e293b';
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.1]} />
          <meshStandardMaterial color={frameColor} transparent={ghost} opacity={opacity} />
        </mesh>
        <mesh>
          <boxGeometry args={[wallLength * 0.9, height * 0.85, 0.04]} />
          <meshStandardMaterial color="#87ceeb" transparent opacity={ghost ? GHOST_OPACITY : 0.6} roughness={0.1} />
        </mesh>
      </group>
    );
  }

  if (item.type === 'vent') {
    const ventColor = isSelected ? SELECTED_COLOR : ghost ? '#6b7280' : ELEMENT_COLORS_3D.vent;
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.12]} />
          <meshStandardMaterial color={ventColor} roughness={0.5} transparent={ghost} opacity={opacity} />
        </mesh>
      </group>
    );
  }

  return null;
}

function Pillar3D({ pillar, isSelected, onItemClick, onItemPointerDown, ghost = false }) {
  const { x: cx, z: cz } = toWorld(pillar.x, pillar.y);
  const h = (pillar.height || 250) * SCALE;
  const r = (pillar.radius || 15) * SCALE;
  const bottom = (pillar.bottomOffset || 0) * SCALE;
  const color = isSelected ? SELECTED_COLOR : ghost ? '#6b7280' : '#9ca3af';

  return (
    <mesh
      position={[cx, bottom + h / 2, cz]}
      onClick={(e) => {
        e.stopPropagation();
        onItemClick(pillar);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onItemPointerDown(pillar);
      }}
    >
      {pillar.shape === 'square' ? (
        <boxGeometry args={[r * 2, h, r * 2]} />
      ) : (
        <cylinderGeometry args={[r, r, h, 20]} />
      )}
      <meshStandardMaterial color={color} roughness={0.5} transparent={ghost} opacity={ghost ? GHOST_OPACITY : 1} />
    </mesh>
  );
}

// Auto-generates a floor's roof and/or ceiling from the convex hull of
// its walls' plan points (see convexHull in utils/geometry.js for why
// a hull rather than exact room polygons). `elevation` is this floor's
// own local origin (0), since the whole floor is already wrapped in a
// <group> translated to the right world height by the caller.
function RoofCeiling({ floor, elements }) {
  const wallPts = useMemo(() => {
    const pts = [];
    elements
      .filter((e) => (e.type || 'wall') === 'wall')
      .forEach((w) => sampleWallPath(w, 8).forEach((p) => pts.push(p)));
    return pts;
  }, [elements]);

  const hull = useMemo(() => (wallPts.length >= 3 ? convexHull(wallPts) : []), [wallPts]);
  const worldHull = useMemo(() => hull.map((p) => toWorld(p.x, p.y)), [hull]);
  const centroid = useMemo(() => (worldHull.length ? polygonCentroid(worldHull) : { x: 0, z: 0 }), [worldHull]);

  const flatShape = useMemo(() => {
    if (worldHull.length < 3) return null;
    const s = new THREE.Shape();
    worldHull.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.z) : s.lineTo(p.x, p.z)));
    s.closePath();
    return s;
  }, [worldHull]);

  const hipGeometry = useMemo(() => {
    if (floor.roof !== 'hip' || worldHull.length < 3) return null;
    const avgRadius =
      worldHull.reduce((sum, p) => sum + Math.hypot(p.x - centroid.x, p.z - centroid.z), 0) / worldHull.length;
    const apexHeight = Math.max(0.6, avgRadius * 0.5);
    const baseY = (floor.wallHeight || 250) * SCALE;
    const apex = new THREE.Vector3(centroid.x, baseY + apexHeight, centroid.z);
    const positions = [];
    const n = worldHull.length;
    for (let i = 0; i < n; i++) {
      const a = worldHull[i];
      const b = worldHull[(i + 1) % n];
      positions.push(a.x, baseY, a.z, b.x, baseY, b.z, apex.x, apex.y, apex.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, [floor.roof, floor.wallHeight, worldHull, centroid]);

  if (!flatShape) return null;
  const baseY = (floor.wallHeight || 250) * SCALE;

  return (
    <group>
      {floor.ceiling && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseY - 0.03, 0]}>
          <shapeGeometry args={[flatShape]} />
          <meshStandardMaterial color="#e5e7eb" side={THREE.DoubleSide} transparent opacity={0.55} />
        </mesh>
      )}
      {floor.roof === 'flat' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, baseY + 0.08, 0]}>
          <shapeGeometry args={[flatShape]} />
          <meshStandardMaterial color="#4b5563" side={THREE.DoubleSide} />
        </mesh>
      )}
      {hipGeometry && (
        <mesh geometry={hipGeometry}>
          <meshStandardMaterial color="#7c2d12" side={THREE.DoubleSide} roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

function GroundPlane({ onFloorClick }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onFloorClick(e.point);
      }}
    >
      <planeGeometry args={[50, 50]} />
      <meshStandardMaterial color="#333333" />
    </mesh>
  );
}

// Raycasts pointer movement onto a horizontal plane at `planeY` (world
// units) to get a 3D drag point. `planeY` MUST match the active floor's
// elevation -- for a perspective camera, intersecting the wrong height
// plane shifts x/z too (not just y), so dragging on an upper floor
// would otherwise silently drift.
function DragTracker({ active, planeY = 0, onMove, onEnd }) {
  const { camera, gl } = useThree();
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY));
  const raycasterRef = useRef(new THREE.Raycaster());

  useEffect(() => {
    planeRef.current.set(new THREE.Vector3(0, 1, 0), -planeY);
  }, [planeY]);

  useEffect(() => {
    if (!active) return;
    const dom = gl.domElement;

    const pointFromEvent = (clientX, clientY) => {
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(ndc, camera);
      const point = new THREE.Vector3();
      const hit = raycasterRef.current.ray.intersectPlane(planeRef.current, point);
      return hit ? point : null;
    };

    const handleMove = (e) => {
      const point = pointFromEvent(e.clientX, e.clientY);
      if (point) onMove(point);
    };
    const handleUp = () => onEnd();

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [active, camera, gl, onMove, onEnd]);

  return null;
}

// Captures the pre-drag plan coordinates of whichever element(s) are
// about to move, in whichever shape they use -- segment-based
// (x1,y1,x2,y2) for walls/openings, or point-based (x,y) for pillars.
function captureOrig(item) {
  return item.type === 'pillar'
    ? { x: item.x, y: item.y }
    : { x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 };
}

function GhostFloor({ floor, elements }) {
  const wallItems = elements.filter((e) => (e.type || 'wall') === 'wall');
  const openingItems = elements.filter((e) => ['door', 'window', 'vent'].includes(e.type));
  const pillarItems = elements.filter((e) => e.type === 'pillar');
  const noop = () => {};

  return (
    <>
      {wallItems.map((w) => (
        <Wall3D
          key={w.id}
          wall={w}
          openings={openingItems.filter((o) => o.wallId === w.id)}
          isSelected={false}
          onWallClick={noop}
          onWallPointerDown={noop}
          ghost
        />
      ))}
      {openingItems.map((o) => (
        <OpeningElement key={o.id} item={o} isSelected={false} onItemClick={noop} onItemPointerDown={noop} ghost />
      ))}
      {pillarItems.map((p) => (
        <Pillar3D key={p.id} pillar={p} isSelected={false} onItemClick={noop} onItemPointerDown={noop} ghost />
      ))}
      <RoofCeiling floor={floor} elements={elements} />
    </>
  );
}

export default function Scene3D({
  elements = [],
  allElements = null,
  floors = [],
  activeFloorId = null,
  elevations = {},
  wallHeight = 250,
  tool = null,
  curvedMode = false,
  color = '#000000',
  lineWidth = 6,
  onChange = () => {},
  selectedId = null,
  onSelect = () => {},
}) {
  const [pendingStart, setPendingStart] = useState(null);
  const dragSessionRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [draftWalls, setDraftWalls] = useState(null);
  const displayWalls = draftWalls || elements;

  const activeFloor = floors.find((f) => f.id === activeFloorId) || { wallHeight, roof: 'none', ceiling: false };
  const activeElevation = elevations[activeFloorId] || 0;
  const otherFloors = allElements ? floors.filter((f) => f.id !== activeFloorId) : [];

  const wallItems = useMemo(() => displayWalls.filter((w) => (w.type || 'wall') === 'wall'), [displayWalls]);
  const openingItems = useMemo(
    () => displayWalls.filter((w) => ['door', 'window', 'vent'].includes(w.type)),
    [displayWalls]
  );
  const pillarItems = useMemo(() => displayWalls.filter((w) => w.type === 'pillar'), [displayWalls]);

  const handleWallClick = useCallback(
    (wall, point) => {
      if (['door', 'window', 'vent'].includes(tool)) {
        // Openings can't be anchored on curved walls (see buildWallBoxes) --
        // just select it instead of attempting a bad placement.
        if (wall.curved && wall.bow) {
          onSelect(wall.id);
          return;
        }
        const defaults = TOOL_DEFAULTS[tool];
        const start = toWorld(wall.x1, wall.y1);
        const end = toWorld(wall.x2, wall.y2);
        const wallLength3D = Math.hypot(end.x - start.x, end.z - start.z);
        if (wallLength3D === 0) return;

        let u = ((point.x - start.x) * (end.x - start.x) + (point.z - start.z) * (end.z - start.z)) / (wallLength3D * wallLength3D);
        const wallLengthPx = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
        const halfWidthU = Math.min(0.45, (defaults.width / 2) / wallLengthPx);
        u = Math.max(halfWidthU, Math.min(1 - halfWidthU, u));

        const uStart = u - halfWidthU;
        const uEnd = u + halfWidthU;
        const newItem = {
          id: Date.now().toString(),
          type: tool,
          floorId: activeFloorId,
          wallId: wall.id,
          x1: wall.x1 + uStart * (wall.x2 - wall.x1),
          y1: wall.y1 + uStart * (wall.y2 - wall.y1),
          x2: wall.x1 + uEnd * (wall.x2 - wall.x1),
          y2: wall.y1 + uEnd * (wall.y2 - wall.y1),
          height: defaults.height,
          bottomOffset: defaults.bottomOffset,
          color: '#000000',
          lineWidth: 4,
        };
        onChange([...elements, newItem]);
        onSelect(newItem.id);
        return;
      }

      if (tool === 'eraser') {
        onChange(elements.filter((w) => w.id !== wall.id && w.wallId !== wall.id));
        if (selectedId === wall.id) onSelect(null);
        return;
      }

      onSelect(wall.id);
    },
    [tool, elements, onChange, onSelect, selectedId, activeFloorId]
  );

  const handleItemClick = useCallback(
    (item) => {
      if (tool === 'eraser') {
        onChange(elements.filter((w) => w.id !== item.id));
        if (selectedId === item.id) onSelect(null);
        return;
      }
      onSelect(item.id);
    },
    [tool, elements, onChange, onSelect, selectedId]
  );

  const handleWallPointerDown = useCallback(
    (wall) => {
      if (tool !== 'select') return;
      onSelect(wall.id);
      const attached = elements.filter((w) => w.wallId === wall.id);
      const origPositions = { [wall.id]: captureOrig(wall) };
      attached.forEach((o) => {
        origPositions[o.id] = captureOrig(o);
      });
      dragSessionRef.current = { mode: 'translate', origPositions, baseline: null };
      setDragActive(true);
    },
    [tool, elements, onSelect]
  );

  const handleItemPointerDown = useCallback(
    (item) => {
      if (tool !== 'select') return;
      onSelect(item.id);
      dragSessionRef.current = {
        mode: 'translate',
        origPositions: { [item.id]: captureOrig(item) },
        baseline: null,
      };
      setDragActive(true);
    },
    [tool, onSelect]
  );

  const handleDragMove = useCallback(
    (point3D) => {
      const session = dragSessionRef.current;
      if (!session) return;
      const plan = toPlan(point3D.x, point3D.z);

      if (session.mode === 'translate') {
        if (!session.baseline) session.baseline = plan;
        const dx = plan.x - session.baseline.x;
        const dy = plan.y - session.baseline.y;
        const updated = elements.map((w) => {
          const orig = session.origPositions[w.id];
          if (!orig) return w;
          if (w.type === 'pillar') {
            return { ...w, x: orig.x + dx, y: orig.y + dy };
          }
          return { ...w, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
        });
        setDraftWalls(updated);
      }
    },
    [elements]
  );

  const handleDragEnd = useCallback(() => {
    if (dragSessionRef.current && draftWalls) {
      onChange(draftWalls);
    }
    dragSessionRef.current = null;
    setDragActive(false);
    setDraftWalls(null);
  }, [draftWalls, onChange]);

  const handleFloorClick = useCallback(
    (point) => {
      if (tool === 'pillar') {
        const plan = toPlan(point.x, point.z);
        const newPillar = createPillar(plan.x, plan.y, activeFloorId, wallHeight);
        onChange([...elements, newPillar]);
        onSelect(newPillar.id);
        return;
      }

      if (tool !== 'wall') {
        onSelect(null);
        return;
      }
      const plan = toPlan(point.x, point.z);
      if (!pendingStart) {
        setPendingStart(plan);
        return;
      }
      const dist = Math.hypot(plan.x - pendingStart.x, plan.y - pendingStart.y);
      if (dist > 5) {
        const newWall = {
          id: Date.now().toString(),
          type: 'wall',
          floorId: activeFloorId,
          x1: pendingStart.x,
          y1: pendingStart.y,
          x2: plan.x,
          y2: plan.y,
          height: wallHeight,
          bottomOffset: 0,
          curved: curvedMode,
          bow: 0,
          color,
          lineWidth,
        };
        onChange([...elements, newWall]);
      }
      setPendingStart(null);
    },
    [tool, pendingStart, elements, onChange, onSelect, color, lineWidth, activeFloorId, wallHeight, curvedMode]
  );

  const pendingMarker = pendingStart ? toWorld(pendingStart.x, pendingStart.y) : null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a1a' }}>
      <Canvas camera={{ position: [0, 15 + (activeElevation * SCALE) / 2, 25], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 20, 15]} intensity={1.2} />
        <pointLight position={[-10, 10, -10]} intensity={0.5} />

        <DragTracker active={dragActive} planeY={activeElevation * SCALE} onMove={handleDragMove} onEnd={handleDragEnd} />

        {/* Active floor: fully interactive, at its real world elevation */}
        <group position={[0, activeElevation * SCALE, 0]}>
          <GroundPlane onFloorClick={handleFloorClick} />
          <gridHelper args={[50, 50, '#007bff', '#555555']} position={[0, 0.01, 0]} />

          {pendingMarker && (
            <mesh position={[pendingMarker.x, 0.15, pendingMarker.z]}>
              <sphereGeometry args={[0.15, 16, 16]} />
              <meshStandardMaterial color="#007bff" />
            </mesh>
          )}

          {wallItems.map((wall) => (
            <Wall3D
              key={wall.id}
              wall={wall}
              openings={openingItems.filter((o) => o.wallId === wall.id)}
              isSelected={selectedId === wall.id}
              onWallClick={handleWallClick}
              onWallPointerDown={handleWallPointerDown}
            />
          ))}

          {openingItems.map((item) => (
            <OpeningElement
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onItemClick={handleItemClick}
              onItemPointerDown={handleItemPointerDown}
            />
          ))}

          {pillarItems.map((item) => (
            <Pillar3D
              key={item.id}
              pillar={item}
              isSelected={selectedId === item.id}
              onItemClick={handleItemClick}
              onItemPointerDown={handleItemPointerDown}
            />
          ))}

          <RoofCeiling floor={activeFloor} elements={elements} />
        </group>

        {/* Other floors: dimmed, non-interactive context so you can see
            the whole building while editing one floor at a time. */}
        {allElements &&
          otherFloors.map((f) => (
            <group key={f.id} position={[0, (elevations[f.id] || 0) * SCALE, 0]}>
              <GhostFloor floor={f} elements={allElements.filter((e) => e.floorId === f.id)} />
            </group>
          ))}

        <OrbitControls makeDefault enabled={!dragActive} target={[0, activeElevation * SCALE + 1.2, 0]} />
      </Canvas>
    </div>
  );
}
