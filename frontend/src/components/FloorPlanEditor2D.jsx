import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { distanceToSegment, projectPointOnSegment, SCALE } from '../utils/geometry.js';
import { getOpeningDefaults } from '../utils/openings.js';

const COLOR_MAP = {
  wall: '#ffffff',
  door: '#8B4513',
  window: '#87ceeb',
  vent: '#ff8c00',
};

const GRID_SIZE = 20;

function snap(value, enabled) {
  return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;
}

const FloorPlanEditor2D = forwardRef(function FloorPlanEditor2D(
  {
    walls = [],
    tool = 'select',
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

    // Draw elements
    walls.forEach((item) => {
      const isSelected = item.id === selectedId;
      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
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
      }
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
  }, [walls, selectedId, drawingStart, mousePos, tool, snapEnabled]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = (e) => {
    const coords = getCanvasCoords(e);
    interactionCheckpointRef.current = false;

    if (tool === 'select') {
      const selectedItem = walls.find((w) => w.id === selectedId);

      if (selectedItem) {
        if (Math.hypot(coords.x - selectedItem.x1, coords.y - selectedItem.y1) < 12) {
          setDragState({ mode: 'handle', handle: 'p1', id: selectedItem.id });
          return;
        }
        if (Math.hypot(coords.x - selectedItem.x2, coords.y - selectedItem.y2) < 12) {
          setDragState({ mode: 'handle', handle: 'p2', id: selectedItem.id });
          return;
        }
      }

      const clicked = walls.find((w) => distanceToSegment(coords.x, coords.y, w.x1, w.y1, w.x2, w.y2) < 10);

      if (clicked) {
        onSelect(clicked.id);
        setDragState({
          mode: 'move',
          id: clicked.id,
          startX: coords.x,
          startY: coords.y,
          orig: { ...clicked },
        });
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
          x1: drawingStart.x,
          y1: drawingStart.y,
          x2: snapped.x,
          y2: snapped.y,
          height: 250,
          bottomOffset: 0,
        };
        onChange([...walls, newWall]);
        setDrawingStart(null);
      }
      return;
    }

    if (['door', 'window', 'vent'].includes(tool)) {
      const defaults = getOpeningDefaults(tool);
      const half = defaults.width / 2;

      // Find nearest wall to align angle automatically
      const nearestWall = walls
        .filter((w) => (w.type || 'wall') === 'wall')
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

      onChange([...walls, newItem]);
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
        walls.map((w) => {
          if (w.id !== dragState.id) return w;
          if (dragState.handle === 'p1') {
            return { ...w, x1: sx, y1: sy };
          } else {
            return { ...w, x2: sx, y2: sy };
          }
        }),
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
        walls.map((w) => {
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
