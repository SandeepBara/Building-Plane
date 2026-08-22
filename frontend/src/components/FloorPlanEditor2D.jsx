import React, { useRef, useState, useEffect } from 'react';
import { distanceToSegment, projectPointOnSegment } from '../utils/geometry.js';

const ELEMENT_COLORS = {
  wall: '#333333',
  door: '#8B4513',   // Brown
  window: '#00BFFF', // Sky Blue
  vent: '#FF8C00',   // Orange
};

// How close (in px) a door/window/vent stroke needs to be to a wall before
// it snaps onto that wall and becomes a real "opening" in it.
const WALL_SNAP_THRESHOLD = 20;

const FloorPlanEditor2D = ({
  walls = [],
  onChange,
  tool = 'wall',
  color = '#000000',
  lineWidth = 3,
  selectedId = null,
  onSelect = () => {},
  onDeleteSelected = () => {},
}) => {
  const canvasRef = useRef(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });

  // --- Drag state (Select & Drag tool) ---
  // draftWalls is a live preview of `walls` while a drag is in progress; we
  // only call onChange once, on mouse-up, so the parent isn't re-rendered
  // on every pixel of movement. dragRef holds the session's math (what's
  // moving and how) and doesn't need to trigger re-renders itself.
  const [draftWalls, setDraftWalls] = useState(null);
  const dragRef = useRef(null);
  const displayWalls = draftWalls || walls;

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;

  // --- Rendering Loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw saved items (or the live drag preview, while dragging)
    displayWalls.forEach((item) => {
      const itemType = item.type || 'wall';
      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
      ctx.lineWidth = itemType === 'wall' ? (item.lineWidth || 6) : 4;
      ctx.strokeStyle = item.id === selectedId ? '#007bff' : (ELEMENT_COLORS[itemType] || item.color || '#333333');

      // Dashed lines for openings (windows & vents)
      if (itemType === 'window' || itemType === 'vent') {
        ctx.setLineDash([8, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    });

    // Reset dash for preview
    ctx.setLineDash([]);

    // Draw active drawing preview
    if (isDrawing && tool !== 'select') {
      ctx.beginPath();
      ctx.lineWidth = tool === 'wall' || tool === 'rect' ? lineWidth : 4;
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : (ELEMENT_COLORS[tool] || color);

      if (tool === 'rect') {
        const width = currentPos.x - startPos.x;
        const height = currentPos.y - startPos.y;
        ctx.strokeRect(startPos.x, startPos.y, width, height);
      } else {
        if (tool === 'window' || tool === 'vent') ctx.setLineDash([8, 4]);
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(currentPos.x, currentPos.y);
        ctx.stroke();
      }
    }
  }, [displayWalls, isDrawing, startPos, currentPos, selectedId, tool, color, lineWidth]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e) => {
    const pos = getPos(e);

    if (tool === 'select') {
      const clickedItem = walls.find(
        (w) => distanceToSegment(pos.x, pos.y, w.x1, w.y1, w.x2, w.y2) < 10
      );
      onSelect(clickedItem ? clickedItem.id : null);
      if (!clickedItem) {
        dragRef.current = null;
        return;
      }

      const itemType = clickedItem.type || 'wall';

      if (itemType === 'wall') {
        // Translate the wall, and translate any door/window/vent cut into
        // it by the same amount so the opening stays put relative to it.
        const attached = walls.filter((w) => w.wallId === clickedItem.id);
        const origPositions = {
          [clickedItem.id]: { x1: clickedItem.x1, y1: clickedItem.y1, x2: clickedItem.x2, y2: clickedItem.y2 },
        };
        attached.forEach((o) => {
          origPositions[o.id] = { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
        });
        dragRef.current = { mode: 'translate', startMouse: pos, origPositions };
      } else if (clickedItem.wallId) {
        // Door/window/vent snapped to a wall: slide along that wall's line
        // instead of translating freely, keeping its width constant.
        const parentWall = walls.find((w) => w.id === clickedItem.wallId);
        if (parentWall) {
          const p1 = projectPointOnSegment(clickedItem.x1, clickedItem.y1, parentWall.x1, parentWall.y1, parentWall.x2, parentWall.y2);
          const p2 = projectPointOnSegment(clickedItem.x2, clickedItem.y2, parentWall.x1, parentWall.y1, parentWall.x2, parentWall.y2);
          const halfWidthU = Math.abs(p2.t - p1.t) / 2;
          dragRef.current = { mode: 'slide', id: clickedItem.id, wall: parentWall, halfWidthU };
        } else {
          dragRef.current = {
            mode: 'translate',
            startMouse: pos,
            origPositions: { [clickedItem.id]: { x1: clickedItem.x1, y1: clickedItem.y1, x2: clickedItem.x2, y2: clickedItem.y2 } },
          };
        }
      } else {
        // Unsnapped opening: translate freely, then try to snap onto a
        // wall (like on creation) once the drag ends.
        dragRef.current = {
          mode: 'translate',
          startMouse: pos,
          origPositions: { [clickedItem.id]: { x1: clickedItem.x1, y1: clickedItem.y1, x2: clickedItem.x2, y2: clickedItem.y2 } },
          tryResnapId: clickedItem.id,
        };
      }
    } else {
      setStartPos(pos);
      setCurrentPos(pos);
      setIsDrawing(true);
      onSelect(null);
    }
  };

  const handleMouseMove = (e) => {
    if (tool === 'select') {
      const drag = dragRef.current;
      if (!drag) return;
      const pos = getPos(e);

      if (drag.mode === 'translate') {
        const dx = pos.x - drag.startMouse.x;
        const dy = pos.y - drag.startMouse.y;
        const updated = walls.map((w) => {
          const orig = drag.origPositions[w.id];
          if (!orig) return w;
          return { ...w, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
        });
        setDraftWalls(updated);
      } else if (drag.mode === 'slide') {
        const wall = drag.wall;
        const proj = projectPointOnSegment(pos.x, pos.y, wall.x1, wall.y1, wall.x2, wall.y2);
        const t = Math.max(drag.halfWidthU, Math.min(1 - drag.halfWidthU, proj.t));
        const uStart = t - drag.halfWidthU;
        const uEnd = t + drag.halfWidthU;
        const nx1 = wall.x1 + uStart * (wall.x2 - wall.x1);
        const ny1 = wall.y1 + uStart * (wall.y2 - wall.y1);
        const nx2 = wall.x1 + uEnd * (wall.x2 - wall.x1);
        const ny2 = wall.y1 + uEnd * (wall.y2 - wall.y1);
        const updated = walls.map((w) => (w.id === drag.id ? { ...w, x1: nx1, y1: ny1, x2: nx2, y2: ny2 } : w));
        setDraftWalls(updated);
      }
      return;
    }

    if (!isDrawing || tool === 'select') return;
    setCurrentPos(getPos(e));
  };

  // Commits (or safely cancels) an in-progress drag. Shared by mouse-up
  // and mouse-leave so a drag never gets stuck if the pointer leaves the
  // canvas mid-drag.
  const commitDrag = () => {
    const drag = dragRef.current;
    if (!drag) return false;

    let finalWalls = draftWalls || walls;

    if (drag.tryResnapId) {
      const item = finalWalls.find((w) => w.id === drag.tryResnapId);
      if (item) {
        const snapped = snapToWall({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 });
        if (snapped) {
          finalWalls = finalWalls.map((w) => (w.id === item.id ? { ...w, ...snapped } : w));
        }
      }
    }

    if (finalWalls !== walls) onChange(finalWalls);
    dragRef.current = null;
    setDraftWalls(null);
    return true;
  };

  // Finds the nearest wall to a door/window/vent stroke and, if it's close
  // enough, snaps both endpoints exactly onto that wall's line. This is
  // what lets the 3D view later cut a real opening into the wall.
  const snapToWall = (p1, p2) => {
    const wallsOnly = walls.filter((w) => (w.type || 'wall') === 'wall');
    if (!wallsOnly.length) return null;

    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    let nearest = null;
    let nearestDist = Infinity;
    wallsOnly.forEach((w) => {
      const d = distanceToSegment(midX, midY, w.x1, w.y1, w.x2, w.y2);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = w;
      }
    });

    if (!nearest || nearestDist > WALL_SNAP_THRESHOLD) return null;

    const proj1 = projectPointOnSegment(p1.x, p1.y, nearest.x1, nearest.y1, nearest.x2, nearest.y2);
    const proj2 = projectPointOnSegment(p2.x, p2.y, nearest.x1, nearest.y1, nearest.x2, nearest.y2);

    return {
      wallId: nearest.id,
      x1: proj1.x,
      y1: proj1.y,
      x2: proj2.x,
      y2: proj2.y,
    };
  };

  const handleMouseUp = (e) => {
    if (tool === 'select') {
      commitDrag();
      return;
    }

    if (!isDrawing || tool === 'select') return;
    setIsDrawing(false);

    const endPos = getPos(e);
    const distance = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y);
    if (distance < 3) return;

    if (tool === 'rect') {
      const rectWalls = [
        { id: `${Date.now()}-1`, type: 'wall', x1: startPos.x, y1: startPos.y, x2: endPos.x, y2: startPos.y, height: 250, bottomOffset: 0, color, lineWidth },
        { id: `${Date.now()}-2`, type: 'wall', x1: endPos.x, y1: startPos.y, x2: endPos.x, y2: endPos.y, height: 250, bottomOffset: 0, color, lineWidth },
        { id: `${Date.now()}-3`, type: 'wall', x1: endPos.x, y1: endPos.y, x2: startPos.x, y2: endPos.y, height: 250, bottomOffset: 0, color, lineWidth },
        { id: `${Date.now()}-4`, type: 'wall', x1: startPos.x, y1: endPos.y, x2: startPos.x, y2: startPos.y, height: 250, bottomOffset: 0, color, lineWidth },
      ];
      onChange([...walls, ...rectWalls]);
    } else {
      // Set distinct 3D heights and floor offsets based on element type
      let height = 250;
      let bottomOffset = 0;

      if (tool === 'door') {
        height = 210;
        bottomOffset = 0;
      } else if (tool === 'window') {
        height = 120;
        bottomOffset = 90;
      } else if (tool === 'vent') {
        height = 40;
        bottomOffset = 200;
      }

      let x1 = startPos.x, y1 = startPos.y, x2 = endPos.x, y2 = endPos.y;
      let wallId;

      // Doors/windows/vents snap onto the nearest wall so the 3D view can
      // cut a real opening into it instead of just overlapping it.
      if (tool === 'door' || tool === 'window' || tool === 'vent') {
        const snapped = snapToWall(startPos, endPos);
        if (snapped) {
          wallId = snapped.wallId;
          x1 = snapped.x1; y1 = snapped.y1;
          x2 = snapped.x2; y2 = snapped.y2;
        }
      }

      const newItem = {
        id: Date.now().toString(),
        type: tool === 'eraser' ? 'wall' : tool,
        x1, y1, x2, y2,
        height,
        bottomOffset,
        color: tool === 'eraser' ? '#ffffff' : color,
        lineWidth,
        ...(wallId ? { wallId } : {}),
      };
      onChange([...walls, newItem]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        onDeleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, onDeleteSelected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          border: '2px solid #ccc',
          overflow: 'hidden',
          backgroundColor: '#fafafa',
          position: 'relative'
        }}
      >
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: 'linear-gradient(#e0e0e0 1px, transparent 1px), linear-gradient(90deg, #e0e0e0 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          pointerEvents: 'none'
        }} />

        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => tool === 'select' && commitDrag()}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            cursor: tool === 'select' ? (draftWalls ? 'grabbing' : 'grab') : 'crosshair'
          }}
        />
      </div>
    </div>
  );
};

export default FloorPlanEditor2D;