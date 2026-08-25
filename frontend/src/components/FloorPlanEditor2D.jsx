import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  distanceToSegment,
  distanceToWallPath,
  projectPointOnSegment,
  curveControlPoint,
  wallCurveMidpoint,
  SCALE,
} from '../utils/geometry.js';
import { getOpeningDefaults } from '../utils/openings.js';
import { createPillar } from '../utils/elements.js';

const COLOR_MAP = {
  wall: '#ffffff',
  door: '#8B4513',
  window: '#87ceeb',
  vent: '#ff8c00',
};

const GRID_SIZE = 20;
const BULGE_HANDLE_COLOR = '#ffaa00';

function snap(value, enabled) {
  return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;
}

const FloorPlanEditor2D = forwardRef(function FloorPlanEditor2D(
  {
    elements = [],
    tool = 'select',
    curvedMode = false,
    activeFloorId = null,
    wallHeight = 250,
    onChange = () => {},
    onBeginInteraction = () => {},
    selectedId = null,
    onSelect = () => {},
    snapEnabled = true,
  },
  ref
) {
  const canvasRef = useRef(null);
  const [drawingStart, setDrawingStart] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState(null);
  // Tracks whether we've already pushed an undo checkpoint for the drag
  // currently in progress, so a whole drag collapses into one undo step.
  const interactionCheckpointRef = useRef(false);

  useImperativeHandle(ref, () => ({
    exportImage() {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : null;
    },
  }));

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw walls/doors/windows/vents (segment-based elements)
    elements.forEach((item) => {
      if (item.type === 'pillar') return; // drawn separately, on top
      const isSelected = item.id === selectedId;
      const isCurved = (item.type || 'wall') === 'wall' && item.curved && item.bow;

      ctx.beginPath();
      if (isCurved) {
        const { x: cx, y: cy } = curveControlPoint(item.x1, item.y1, item.x2, item.y2, item.bow);
        ctx.moveTo(item.x1, item.y1);
        ctx.quadraticCurveTo(cx, cy, item.x2, item.y2);
      } else {
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
      }
      ctx.strokeStyle = isSelected ? '#007bff' : COLOR_MAP[item.type || 'wall'] || '#ffffff';
      ctx.lineWidth = isSelected ? 8 : item.lineWidth || 6;
      ctx.lineCap = 'round';
      ctx.stroke();

      if (isSelected) {
        // Handle 1 (Start)
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.arc(item.x1, item.y1, 6, 0, Math.PI * 2);
        ctx.fill();

        // Handle 2 (End)
        ctx.fillStyle = '#00ffcc';
        ctx.beginPath();
        ctx.arc(item.x2, item.y2, 6, 0, Math.PI * 2);
        ctx.fill();

        // Bulge handle (curved walls only) -- drag to bend the wall
        if ((item.type || 'wall') === 'wall') {
          const mid = wallCurveMidpoint(item);
          ctx.fillStyle = BULGE_HANDLE_COLOR;
          ctx.beginPath();
          ctx.arc(mid.x, mid.y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // Draw pillars on top of walls
    elements
      .filter((item) => item.type === 'pillar')
      .forEach((p) => {
        const isSelected = p.id === selectedId;
        ctx.beginPath();
        if (p.shape === 'square') {
          ctx.rect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
        } else {
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        }
        ctx.fillStyle = isSelected ? '#007bff' : '#a3a3a3';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

    // Draw active creation preview line + live length readout
    if (drawingStart && tool === 'wall') {
      const endX = snap(mousePos.x, snapEnabled);
      const endY = snap(mousePos.y, snapEnabled);
      ctx.beginPath();
      ctx.moveTo(drawingStart.x, drawingStart.y);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 4;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      const lengthPx = Math.hypot(endX - drawingStart.x, endY - drawingStart.y);
      const lengthM = (lengthPx * SCALE).toFixed(2);
      const midX = (drawingStart.x + endX) / 2;
      const midY = (drawingStart.y + endY) / 2;
      ctx.font = '13px sans-serif';
      const label = `${lengthM} m`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(midX - textWidth / 2 - 4, midY - 22, textWidth + 8, 18);
      ctx.fillStyle = '#00ffcc';
      ctx.fillText(label, midX - textWidth / 2, midY - 8);
    }

    // Pillar placement preview (follows cursor)
    if (tool === 'pillar') {
      const px = snap(mousePos.x, snapEnabled);
      const py = snap(mousePos.y, snapEnabled);
      ctx.beginPath();
      ctx.arc(px, py, 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,123,255,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [elements, selectedId, drawingStart, mousePos, tool, snapEnabled]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = (e) => {
    const coords = getCanvasCoords(e);
    interactionCheckpointRef.current = false;

    if (tool === 'select') {
      const selectedItem = elements.find((w) => w.id === selectedId);

      if (selectedItem) {
        if (selectedItem.type === 'pillar') {
          if (Math.hypot(coords.x - selectedItem.x, coords.y - selectedItem.y) < selectedItem.radius + 8) {
            setDragState({ mode: 'movePillar', id: selectedItem.id });
            return;
          }
        } else {
          if (Math.hypot(coords.x - selectedItem.x1, coords.y - selectedItem.y1) < 12) {
            setDragState({ mode: 'handle', handle: 'p1', id: selectedItem.id });
            return;
          }
          if (Math.hypot(coords.x - selectedItem.x2, coords.y - selectedItem.y2) < 12) {
            setDragState({ mode: 'handle', handle: 'p2', id: selectedItem.id });
            return;
          }
          if ((selectedItem.type || 'wall') === 'wall') {
            const mid = wallCurveMidpoint(selectedItem);
            if (Math.hypot(coords.x - mid.x, coords.y - mid.y) < 12) {
              setDragState({ mode: 'bulge', id: selectedItem.id });
              return;
            }
          }
        }
      }

      const clickedPillar = elements.find(
        (w) => w.type === 'pillar' && Math.hypot(coords.x - w.x, coords.y - w.y) < w.radius + 4
      );
      const clicked =
        clickedPillar || elements.find((w) => w.type !== 'pillar' && distanceToWallPath(coords.x, coords.y, w) < 10);

      if (clicked) {
        onSelect(clicked.id);
        if (clicked.type === 'pillar') {
          setDragState({ mode: 'movePillar', id: clicked.id });
        } else {
          setDragState({
            mode: 'move',
            id: clicked.id,
            startX: coords.x,
            startY: coords.y,
            orig: { ...clicked },
          });
        }
      } else {
        onSelect(null);
      }
      return;
    }

    if (tool === 'wall') {
      const snapped = { x: snap(coords.x, snapEnabled), y: snap(coords.y, snapEnabled) };
      if (!drawingStart) {
        setDrawingStart(snapped);
      } else {
        const newWall = {
          id: Date.now().toString(),
          type: 'wall',
          floorId: activeFloorId,
          x1: drawingStart.x,
          y1: drawingStart.y,
          x2: snapped.x,
          y2: snapped.y,
          height: wallHeight,
          bottomOffset: 0,
          curved: curvedMode,
          bow: 0,
        };
        onChange([...elements, newWall]);
        onSelect(newWall.id);
        setDrawingStart(null);
      }
      return;
    }

    if (tool === 'pillar') {
      const snapped = { x: snap(coords.x, snapEnabled), y: snap(coords.y, snapEnabled) };
      const newPillar = createPillar(snapped.x, snapped.y, activeFloorId, wallHeight);
      onChange([...elements, newPillar]);
      onSelect(newPillar.id);
      return;
    }

    if (['door', 'window', 'vent'].includes(tool)) {
      const defaults = getOpeningDefaults(tool);
      const half = defaults.width / 2;

      // Find nearest wall to align angle automatically. Curved walls are
      // skipped here -- opening placement/anchoring assumes a straight
      // chord, so openings can only be attached to straight walls.
      const nearestWall = elements
        .filter((w) => (w.type || 'wall') === 'wall' && !(w.curved && w.bow))
        .map((w) => ({
          wall: w,
          proj: projectPointOnSegment(coords.x, coords.y, w.x1, w.y1, w.x2, w.y2),
        }))
        .filter((item) => Math.sqrt(item.proj.distSq) < 30)
        .sort((a, b) => a.proj.distSq - b.proj.distSq)[0];

      let angle = 0;
      let wallId = null;
      let anchorX = coords.x;
      let anchorY = coords.y;

      if (nearestWall) {
        const w = nearestWall.wall;
        angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
        wallId = w.id;
        anchorX = nearestWall.proj.x;
        anchorY = nearestWall.proj.y;
      }

      const dx = Math.cos(angle) * half;
      const dy = Math.sin(angle) * half;

      const newItem = {
        id: Date.now().toString(),
        type: tool,
        floorId: activeFloorId,
        wallId,
        x1: anchorX - dx,
        y1: anchorY - dy,
        x2: anchorX + dx,
        y2: anchorY + dy,
        // Each opening type gets its own vertical band (see
        // utils/openings.js) so a window and a vent placed on the same
        // wall don't collide with each other.
        height: defaults.height,
        bottomOffset: defaults.bottomOffset,
      };

      onChange([...elements, newItem]);
      onSelect(newItem.id);
    }
  };

  const handleMouseMove = (e) => {
    const coords = getCanvasCoords(e);
    setMousePos(coords);

    if (!dragState) return;

    // First move of this drag: checkpoint the pre-drag state so the
    // entire drag collapses into a single undo step.
    if (!interactionCheckpointRef.current) {
      onBeginInteraction();
      interactionCheckpointRef.current = true;
    }

    if (dragState.mode === 'handle') {
      const sx = snap(coords.x, snapEnabled);
      const sy = snap(coords.y, snapEnabled);
      onChange(
        elements.map((w) => {
          if (w.id !== dragState.id) return w;
          if (dragState.handle === 'p1') {
            return { ...w, x1: sx, y1: sy };
          } else {
            return { ...w, x2: sx, y2: sy };
          }
        }),
        { commit: false }
      );
    } else if (dragState.mode === 'bulge') {
      onChange(
        elements.map((w) => {
          if (w.id !== dragState.id) return w;
          const mx = (w.x1 + w.x2) / 2;
          const my = (w.y1 + w.y2) / 2;
          const dx = w.x2 - w.x1;
          const dy = w.y2 - w.y1;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          // Signed distance of the cursor from the chord, along the
          // chord's perpendicular -- this becomes the new bow.
          let newBow = (coords.x - mx) * nx + (coords.y - my) * ny;
          if (snapEnabled) newBow = Math.round(newBow / GRID_SIZE) * GRID_SIZE;
          return { ...w, curved: true, bow: newBow };
        }),
        { commit: false }
      );
    } else if (dragState.mode === 'movePillar') {
      const sx = snap(coords.x, snapEnabled);
      const sy = snap(coords.y, snapEnabled);
      onChange(
        elements.map((w) => (w.id === dragState.id ? { ...w, x: sx, y: sy } : w)),
        { commit: false }
      );
    } else if (dragState.mode === 'move') {
      let dx = coords.x - dragState.startX;
      let dy = coords.y - dragState.startY;
      if (snapEnabled) {
        const snappedX1 = snap(dragState.orig.x1 + dx, true);
        const snappedY1 = snap(dragState.orig.y1 + dy, true);
        dx = snappedX1 - dragState.orig.x1;
        dy = snappedY1 - dragState.orig.y1;
      }
      onChange(
        elements.map((w) => {
          if (w.id !== dragState.id) return w;
          return {
            ...w,
            x1: dragState.orig.x1 + dx,
            y1: dragState.orig.y1 + dy,
            x2: dragState.orig.x2 + dx,
            y2: dragState.orig.y2 + dy,
          };
        }),
        { commit: false }
      );
    }
  };

  const handleMouseUp = () => {
    setDragState(null);
    interactionCheckpointRef.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      style={{ width: '100%', height: '100%', background: '#111', display: 'block', cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
});

export default FloorPlanEditor2D;
