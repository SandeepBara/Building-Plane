import React, { useRef, useState, useEffect, useCallback } from 'react';
import { distanceToSegment, projectPointOnSegment } from '../utils/geometry.js';

const COLOR_MAP = {
  wall: '#ffffff',
  door: '#8B4513',
  window: '#87ceeb',
  vent: '#ff8c00',
};

export default function FloorPlanEditor2D({
  walls = [],
  tool = 'select',
  onChange = () => {},
  selectedId = null,
  onSelect = () => {},
}) {
  const canvasRef = useRef(null);
  const [drawingStart, setDrawingStart] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState(null);

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
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
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

    // Draw active creation preview line
    if (drawingStart && tool === 'wall') {
      ctx.beginPath();
      ctx.moveTo(drawingStart.x, drawingStart.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 4;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [walls, selectedId, drawingStart, mousePos, tool]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = (e) => {
    const coords = getCanvasCoords(e);

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
      if (!drawingStart) {
        setDrawingStart(coords);
      } else {
        const newWall = {
          id: Date.now().toString(),
          type: 'wall',
          x1: drawingStart.x,
          y1: drawingStart.y,
          x2: coords.x,
          y2: coords.y,
          height: 250,
          bottomOffset: 0,
        };
        onChange([...walls, newWall]);
        setDrawingStart(null);
      }
      return;
    }

    if (['door', 'window', 'vent'].includes(tool)) {
      const widthMap = { door: 80, window: 100, vent: 50 };
      const itemWidth = widthMap[tool] || 60;
      const half = itemWidth / 2;

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

      if (nearestWall) {
        const w = nearestWall.wall;
        angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
        wallId = w.id;
      }

      const dx = Math.cos(angle) * half;
      const dy = Math.sin(angle) * half;

      const newItem = {
        id: Date.now().toString(),
        type: tool,
        wallId,
        x1: coords.x - dx,
        y1: coords.y - dy,
        x2: coords.x + dx,
        y2: coords.y + dy,
        height: tool === 'door' ? 210 : 120,
        bottomOffset: tool === 'door' ? 0 : 90,
      };

      onChange([...walls, newItem]);
      onSelect(newItem.id);
    }
  };

  const handleMouseMove = (e) => {
    const coords = getCanvasCoords(e);
    setMousePos(coords);

    if (!dragState) return;

    if (dragState.mode === 'handle') {
      onChange(
        walls.map((w) => {
          if (w.id !== dragState.id) return w;
          if (dragState.handle === 'p1') {
            return { ...w, x1: coords.x, y1: coords.y };
          } else {
            return { ...w, x2: coords.x, y2: coords.y };
          }
        })
      );
    } else if (dragState.mode === 'move') {
      const dx = coords.x - dragState.startX;
      const dy = coords.y - dragState.startY;
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
        })
      );
    }
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      style={{ width: '100%', height: '100%', background: '#111', display: 'block' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
}