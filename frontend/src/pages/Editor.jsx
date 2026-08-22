import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FloorPlanEditor2D from '../components/FloorPlanEditor2D';
import Scene3D from '../components/Scene3D';
import PropertyPanel from '../components/PropertyPanel';
import { api } from '../api.js';
import { SCALE } from '../utils/geometry.js';
import useHistory from '../hooks/useHistory.js';

export default function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const {
    value: walls,
    set: setWalls,
    beginInteraction,
    undo,
    redo,
    reset: resetWalls,
    canUndo,
    canRedo,
  } = useHistory([]);
  const [tool, setTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode, setViewMode] = useState('2D');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [savedSnapshot, setSavedSnapshot] = useState(null);

  const editor2DRef = useRef(null);
  // Keep latest values in refs so the single global keydown listener
  // doesn't need to be re-attached on every render.
  const latest = useRef({});
  latest.current = { walls, selectedId, tool, undo, redo };

  // Load project & populate local walls state
  useEffect(() => {
    api
      .getProject(projectId)
      .then(({ project }) => {
        const initialWalls = Array.isArray(project?.design?.walls)
          ? project.design.walls
          : [];

        setProject(project);
        resetWalls(initialWalls);
        setSavedSnapshot(JSON.stringify(initialWalls));
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isDirty = savedSnapshot !== null && JSON.stringify(walls) !== savedSnapshot;

  // Warn before closing/refreshing the tab with unsaved work.
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleDeleteItem = useCallback(
    (id) => {
      // Delete item & remove attached openings if a parent wall is deleted
      setWalls((prev) => prev.filter((w) => w.id !== id && w.wallId !== id));
      setSelectedId((prevSelected) => (prevSelected === id ? null : prevSelected));
    },
    [setWalls]
  );

  const handleDuplicateItem = useCallback(
    (id) => {
      const item = latest.current.walls.find((w) => w.id === id);
      if (!item) return;
      const offset = 24;
      const newItem = {
        ...item,
        id: Date.now().toString(),
        x1: item.x1 + offset,
        y1: item.y1 + offset,
        x2: item.x2 + offset,
        y2: item.y2 + offset,
      };
      setWalls((prev) => [...prev, newItem]);
      setSelectedId(newItem.id);
    },
    [setWalls]
  );

  // Global keyboard shortcuts: undo/redo, duplicate, delete, escape.
  useEffect(() => {
    function onKeyDown(e) {
      const activeTag = document.activeElement && document.activeElement.tagName;
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const { selectedId: curSelectedId, undo: curUndo, redo: curRedo } = latest.current;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        curUndo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        curRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && curSelectedId) {
        e.preventDefault();
        handleDuplicateItem(curSelectedId);
        return;
      }
      if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && curSelectedId) {
        e.preventDefault();
        handleDeleteItem(curSelectedId);
        return;
      }
      if (!isTyping && e.key === 'Escape') {
        setSelectedId(null);
        setTool('select');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteItem, handleDuplicateItem]);

  // Handle Eraser mode directly on click selection
  const handleSelect = (id) => {
    if (tool === 'eraser' && id) {
      handleDeleteItem(id);
    } else {
      setSelectedId(id);
    }
  };

  async function handleSave() {
    if (!project) return;
    setSaveState('saving');

    const updatedDesign = {
      ...project.design,
      walls: walls,
    };

    try {
      await api.saveProject(project.id, {
        name: project.name,
        design: updatedDesign,
      });

      setProject((prev) => ({ ...prev, design: updatedDesign }));
      setSavedSnapshot(JSON.stringify(walls));
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setError(err.message);
      setSaveState('error');
    }
  }

  function handleBack() {
    if (isDirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    navigate('/');
  }

  function handleExportPNG() {
    if (viewMode !== '2D' || !editor2DRef.current) return;
    const dataUrl = editor2DRef.current.exportImage();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `${(project?.name || 'floor-plan').replace(/\s+/g, '-')}.png`;
    link.href = dataUrl;
    link.click();
  }

  const selectedItem = walls.find((item) => item.id === selectedId) || null;

  const handleUpdateItem = (updatedItem, opts) => {
    setWalls((prev) => prev.map((w) => (w.id === updatedItem.id ? updatedItem : w)), opts);
  };

  if (error) return <p className="error page">{error}</p>;
  if (!project) return <p className="page">Loading…</p>;

  const wallSegments = walls.filter((w) => (w.type || 'wall') === 'wall');
  const doorCount = walls.filter((w) => w.type === 'door').length;
  const windowCount = walls.filter((w) => w.type === 'window').length;
  const ventCount = walls.filter((w) => w.type === 'vent').length;
  const totalWallLengthM = (
    wallSegments.reduce((sum, w) => sum + Math.hypot(w.x2 - w.x1, w.y2 - w.y1), 0) * SCALE
  ).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#121212' }}>
      <div style={{ padding: '10px 15px', background: '#1e1e1e', color: '#fff', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="link-button" onClick={handleBack}>
          ← Back
        </button>
        <input
          className="project-name-input"
          value={project?.name || ''}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <button onClick={handleSave} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : isDirty ? 'Save •' : 'Save'}
        </button>
        <button onClick={() => setViewMode('2D')} style={btnStyle(viewMode === '2D')}>2D View</button>
        <button onClick={() => setViewMode('3D')} style={btnStyle(viewMode === '3D')}>3D View</button>

        <div style={dividerStyle} />

        <button onClick={() => setTool('select')} style={btnStyle(tool === 'select')}>Select / Move</button>
        <button onClick={() => setTool('wall')} style={btnStyle(tool === 'wall')}>Wall</button>
        <button onClick={() => setTool('door')} style={btnStyle(tool === 'door')}>Door</button>
        <button onClick={() => setTool('window')} style={btnStyle(tool === 'window')}>Window</button>
        <button onClick={() => setTool('vent')} style={btnStyle(tool === 'vent')}>Vent</button>
        <button onClick={() => setTool('eraser')} style={btnStyle(tool === 'eraser')}>Eraser</button>

        <div style={dividerStyle} />

        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)" style={iconBtnStyle(canUndo)}>
          ↶ Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" style={iconBtnStyle(canRedo)}>
          ↷ Redo
        </button>

        <div style={dividerStyle} />

        <button
          onClick={() => setSnapEnabled((s) => !s)}
          title="Snap new points to the grid"
          style={btnStyle(snapEnabled)}
        >
          Snap: {snapEnabled ? 'On' : 'Off'}
        </button>
        <button
          onClick={handleExportPNG}
          disabled={viewMode !== '2D'}
          title={viewMode !== '2D' ? 'Switch to 2D view to export' : 'Export floor plan as PNG'}
          style={iconBtnStyle(viewMode === '2D')}
        >
          ⬇ Export PNG
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {viewMode === '2D' ? (
              <FloorPlanEditor2D
                ref={editor2DRef}
                walls={walls}
                tool={tool}
                onChange={setWalls}
                onBeginInteraction={beginInteraction}
                selectedId={selectedId}
                onSelect={handleSelect}
                snapEnabled={snapEnabled}
              />
            ) : (
              <Scene3D
                walls={walls}
                tool={tool}
                onChange={setWalls}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </div>
          <div style={statsBarStyle}>
            <span>{wallSegments.length} walls</span>
            <span>{doorCount} doors</span>
            <span>{windowCount} windows</span>
            <span>{ventCount} vents</span>
            <span>{totalWallLengthM} m total wall length</span>
          </div>
        </div>

        <PropertyPanel
          selectedItem={selectedItem}
          onChange={handleUpdateItem}
          onBeginInteraction={beginInteraction}
          onDelete={handleDeleteItem}
          onDuplicate={handleDuplicateItem}
        />
      </div>
    </div>
  );
}

const btnStyle = (active) => ({
  padding: '6px 12px',
  background: active ? '#007bff' : '#333',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: active ? 'bold' : 'normal',
});

const iconBtnStyle = (enabled) => ({
  padding: '6px 12px',
  background: '#333',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: enabled ? 'pointer' : 'default',
  opacity: enabled ? 1 : 0.4,
});

const dividerStyle = {
  width: '1px',
  height: '20px',
  background: '#444',
  margin: '0 4px',
};

const statsBarStyle = {
  padding: '6px 15px',
  background: '#1a1a1a',
  color: '#9aa0a6',
  fontSize: '12px',
  display: 'flex',
  gap: '16px',
  borderTop: '1px solid #2a2a2a',
};
