import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { SCALE, toWorld, toPlan, projectPointOnSegment } from '../utils/geometry.js';

const ELEMENT_COLORS_3D = {
  door: '#8B4513',
  vent: '#ff8c00',
};

const SELECTED_COLOR = '#007bff';

const TOOL_DEFAULTS = {
  door: { height: 210, bottomOffset: 0, width: 90 },
  window: { height: 120, bottomOffset: 90, width: 110 },
  vent: { height: 40, bottomOffset: 200, width: 60 },
};

function wallWorldPoints(wall) {
  return { start: toWorld(wall.x1, wall.y1), end: toWorld(wall.x2, wall.y2) };
}

function buildWallSegments(wall, openings) {
  const H = (wall.height || 250) * SCALE;
  const { start, end } = wallWorldPoints(wall);
  const wallLength3D = Math.hypot(end.x - start.x, end.z - start.z);
  if (wallLength3D === 0) return [];

  const spans = openings
    .map((o) => {
      const p1 = projectPointOnSegment(o.x1, o.y1, wall.x1, wall.y1, wall.x2, wall.y2);
      const p2 = projectPointOnSegment(o.x2, o.y2, wall.x1, wall.y1, wall.x2, wall.y2);
      const uStart = Math.min(p1.t, p2.t);
      const uEnd = Math.max(p1.t, p2.t);
      if (uEnd - uStart < 0.001) return null;
      const bottom = (o.bottomOffset || 0) * SCALE;
      const top = Math.min(bottom + (o.height || 0) * SCALE, H);
      return { uStart, uEnd, bottom, top };
    })
    .filter(Boolean)
    .sort((a, b) => a.uStart - b.uStart);

  const segments = [];
  let cursor = 0;
  spans.forEach((span) => {
    if (span.uStart > cursor) {
      segments.push({ uStart: cursor, uEnd: span.uStart, yStart: 0, yEnd: H });
    }
    if (span.bottom > 0.001) {
      segments.push({ uStart: span.uStart, uEnd: span.uEnd, yStart: 0, yEnd: span.bottom });
    }
    if (span.top < H - 0.001) {
      segments.push({ uStart: span.uStart, uEnd: span.uEnd, yStart: span.top, yEnd: H });
    }
    cursor = Math.max(cursor, span.uEnd);
  });
  if (cursor < 1) {
    segments.push({ uStart: cursor, uEnd: 1, yStart: 0, yEnd: H });
  }
  return segments;
}

function Wall3D({ wall, openings, isSelected, onWallClick, onWallPointerDown }) {
  const { start, end } = wallWorldPoints(wall);
  const angle = Math.atan2(end.z - start.z, end.x - start.x);
  const wallLength3D = Math.hypot(end.x - start.x, end.z - start.z);
  const segments = useMemo(() => buildWallSegments(wall, openings), [wall, openings]);
  const color = isSelected ? SELECTED_COLOR : '#d1d5db';

  return (
    <group>
      {segments.map((seg, i) => {
        const uMid = (seg.uStart + seg.uEnd) / 2;
        const segLength = (seg.uEnd - seg.uStart) * wallLength3D;
        const segHeight = seg.yEnd - seg.yStart;
        if (segLength <= 0.001 || segHeight <= 0.001) return null;
        const cx = start.x + uMid * (end.x - start.x);
        const cz = start.z + uMid * (end.z - start.z);
        const cy = (seg.yStart + seg.yEnd) / 2;
        return (
          <mesh
            key={i}
            position={[cx, cy, cz]}
            rotation={[0, -angle, 0]}
            onPointerDown={(e) => {
              e.stopPropagation();
              onWallPointerDown(wall);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onWallClick(wall, e.point);
            }}
          >
            <boxGeometry args={[segLength, segHeight, 0.2]} />
            <meshStandardMaterial color={color} roughness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

function OpeningElement({ item, isSelected, onItemClick, onItemPointerDown }) {
  const dx = item.x2 - item.x1;
  const dz = item.y2 - item.y1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const { x: cx, z: cz } = toWorld((item.x1 + item.x2) / 2, (item.y1 + item.y2) / 2);
  const height = (item.height || 0) * SCALE;
  const bottomOffset = (item.bottomOffset || 0) * SCALE;
  const wallLength = length * SCALE;
  const cy = bottomOffset + height / 2;

  const handleClick = (e) => {
    e.stopPropagation();
    onItemClick(item);
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
    onItemPointerDown(item);
  };

  if (item.type === 'door') {
    const doorColor = isSelected ? SELECTED_COLOR : ELEMENT_COLORS_3D.door;
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.12]} />
          <meshStandardMaterial color={doorColor} roughness={0.3} />
        </mesh>
        <mesh position={[wallLength * 0.35, 0, 0.08]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial color="#ffd700" metalness={0.8} />
        </mesh>
      </group>
    );
  }

  if (item.type === 'window') {
    const frameColor = isSelected ? SELECTED_COLOR : '#1e293b';
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.10]} />
          <meshStandardMaterial color={frameColor} />
        </mesh>
        <mesh>
          <boxGeometry args={[wallLength * 0.9, height * 0.85, 0.04]} />
          <meshStandardMaterial color="#87ceeb" transparent opacity={0.6} roughness={0.1} />
        </mesh>
      </group>
    );
  }

  if (item.type === 'vent') {
    const ventColor = isSelected ? SELECTED_COLOR : ELEMENT_COLORS_3D.vent;
    return (
      <group position={[cx, cy, cz]} rotation={[0, -angle, 0]} onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh>
          <boxGeometry args={[wallLength, height, 0.12]} />
          <meshStandardMaterial color={ventColor} roughness={0.5} />
        </mesh>
      </group>
    );
  }

  return null;
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

function DragTracker({ active, onMove, onEnd }) {
  const { camera, gl } = useThree();
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const raycasterRef = useRef(new THREE.Raycaster());

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

export default function Scene3D({
  walls = [],
  tool = null,
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
  const displayWalls = draftWalls || walls;

  const wallItems = useMemo(() => displayWalls.filter((w) => (w.type || 'wall') === 'wall'), [displayWalls]);
  const openingItems = useMemo(() => displayWalls.filter((w) => w.type && w.type !== 'wall'), [displayWalls]);

  const handleWallClick = useCallback(
    (wall, point) => {
      if (['door', 'window', 'vent'].includes(tool)) {
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
        onChange([...walls, newItem]);
        onSelect(newItem.id);
        return;
      }

      if (tool === 'eraser') {
        onChange(walls.filter((w) => w.id !== wall.id && w.wallId !== wall.id));
        if (selectedId === wall.id) onSelect(null);
        return;
      }

      onSelect(wall.id);
    },
    [tool, walls, onChange, onSelect, selectedId]
  );

  const handleItemClick = useCallback(
    (item) => {
      if (tool === 'eraser') {
        onChange(walls.filter((w) => w.id !== item.id));
        if (selectedId === item.id) onSelect(null);
        return;
      }
      onSelect(item.id);
    },
    [tool, walls, onChange, onSelect, selectedId]
  );

  const handleWallPointerDown = useCallback(
    (wall) => {
      if (tool !== 'select') return;
      onSelect(wall.id);
      const attached = walls.filter((w) => w.wallId === wall.id);
      const origPositions = { [wall.id]: { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 } };
      attached.forEach((o) => {
        origPositions[o.id] = { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
      });
      dragSessionRef.current = { mode: 'translate', origPositions, baseline: null };
      setDragActive(true);
    },
    [tool, walls, onSelect]
  );

  const handleItemPointerDown = useCallback(
    (item) => {
      if (tool !== 'select') return;
      onSelect(item.id);

      dragSessionRef.current = {
        mode: 'translate',
        origPositions: { [item.id]: { x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 } },
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
        const updated = walls.map((w) => {
          const orig = session.origPositions[w.id];
          if (!orig) return w;
          return { ...w, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
        });
        setDraftWalls(updated);
      }
    },
    [walls]
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
          x1: pendingStart.x,
          y1: pendingStart.y,
          x2: plan.x,
          y2: plan.y,
          height: 250,
          bottomOffset: 0,
          color,
          lineWidth,
        };
        onChange([...walls, newWall]);
      }
      setPendingStart(null);
    },
    [tool, pendingStart, walls, onChange, onSelect, color, lineWidth]
  );

  const pendingMarker = pendingStart ? toWorld(pendingStart.x, pendingStart.y) : null;

  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a1a' }}>
      <Canvas camera={{ position: [0, 15, 25], fov: 50 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 20, 15]} intensity={1.2} />
        <pointLight position={[-10, 10, -10]} intensity={0.5} />

        <DragTracker active={dragActive} onMove={handleDragMove} onEnd={handleDragEnd} />

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

        <OrbitControls makeDefault enabled={!dragActive} />
      </Canvas>
    </div>
  );
}