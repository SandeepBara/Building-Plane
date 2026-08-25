import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FloorPlanEditor2D from '../components/FloorPlanEditor2D';
import Scene3D from '../components/Scene3D';
import PropertyPanel from '../components/PropertyPanel';
import { api } from '../api.js';
import { SCALE } from '../utils/geometry.js';
import { createFloor, computeFloorElevations, normalizeDesign, DEFAULT_WALL_HEIGHT } from '../utils/elements.js';
import useHistory from '../hooks/useHistory.js';

export default function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);

  // `elements` holds every wall/door/window/vent/pillar across ALL
  // floors, undo-tracked as a single history stack (so undo/redo works
  // sensibly even if you switch floors mid-edit). Floors themselves
  // (add/rename/remove/settings) are NOT undo-tracked -- that's
  // structural project setup, not the kind of rapid edit undo is for.
  const {
    value: elements,
    set: setElements,
    beginInteraction,
    undo,
    redo,
    reset: resetElements,
    canUndo,
    canRedo,
  } = useHistory([]);
  const [floors, setFloors] = useState([]);
  const [activeFloorId, setActiveFloorId] = useState(null);

  const [tool, setTool] = useState('select');
  const [curvedMode, setCurvedMode] = useState(false);
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
  latest.current = { undo, redo };

  // Load project & populate local floors/elements state
  useEffect(() => {
    api
      .getProject(projectId)
      .then(({ project }) => {
        const { floors: initialFloors, elements: initialElements } = normalizeDesign(project?.design);

        setProject(project);
        setFloors(initialFloors);
        setActiveFloorId(initialFloors[0]?.id || null);
        resetElements(initialElements);
        setSavedSnapshot(JSON.stringify({ floors: initialFloors, elements: initialElements }));
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const isDirty =
    savedSnapshot !== null && JSON.stringify({ floors, elements }) !== savedSnapshot;

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

  const activeFloor = floors.find((f) => f.id === activeFloorId) || null;
  const floorElevations = computeFloorElevations(floors);
  const activeElements = elements.filter((e) => e.floorId === activeFloorId);

  // The 2D editor and the "active floor" part of the 3D scene only ever
  // see the active floor's elements, and create new elements tagged
  // with that floor's id themselves. This merges whatever they hand
  // back into the full cross-floor `elements` array without disturbing
  // other floors' elements.
  const handleActiveElementsChange = useCallback(
    (updatedOrFn, opts) => {
      setElements((prevAll) => {
        const prevActive = prevAll.filter((e) => e.floorId === activeFloorId);
        const nextActive = typeof updatedOrFn === 'function' ? updatedOrFn(prevActive) : updatedOrFn;
        const others = prevAll.filter((e) => e.floorId !== activeFloorId);
        return [...others, ...nextActive];
      }, opts);
    },
    [activeFloorId, setElements]
  );

  const handleDeleteItem = useCallback(
    (id) => {
      // Delete item & remove attached openings if a parent wall is deleted
      setElements((prev) => prev.filter((w) => w.id !== id && w.wallId !== id));
      setSelectedId((prevSelected) => (prevSelected === id ? null : prevSelected));
    },
    [setElements]
  );

  const handleDuplicateItem = useCallback(
    (id) => {
      const item = elements.find((w) => w.id === id);
      if (!item) return;
      const offset = 24;
      const newItem = { ...item, id: Date.now().toString() };
      if (item.type === 'pillar') {
        newItem.x = item.x + offset;
        newItem.y = item.y + offset;
      } else {
        newItem.x1 = item.x1 + offset;
        newItem.y1 = item.y1 + offset;
        newItem.x2 = item.x2 + offset;
        newItem.y2 = item.y2 + offset;
      }
      setElements((prev) => [...prev, newItem]);
      setSelectedId(newItem.id);
    },
    [elements, setElements]
  );

  // Global keyboard shortcuts: undo/redo, duplicate, delete, escape.
  useEffect(() => {
    function onKeyDown(e) {
      const activeTag = document.activeElement && document.activeElement.tagName;
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      const { undo: curUndo, redo: curRedo } = latest.current;

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
      if (mod && e.key.toLowerCase() === 'd' && selectedId) {
        e.preventDefault();
        handleDuplicateItem(selectedId);
        return;
      }
      if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        handleDeleteItem(selectedId);
        return;
      }
      if (!isTyping && e.key === 'Escape') {
        setSelectedId(null);
        setTool('select');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteItem, handleDuplicateItem, selectedId]);

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

    const updatedDesign = { ...project.design, floors, elements };

    try {
      await api.saveProject(project.id, {
        name: project.name,
        design: updatedDesign,
      });

      setProject((prev) => ({ ...prev, design: updatedDesign }));
      setSavedSnapshot(JSON.stringify({ floors, elements }));
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

  // --- Floor management ---
  function handleAddFloor() {
    const newFloor = createFloor(null, floors.length);
    setFloors((prev) => [...prev, newFloor]);
    setActiveFloorId(newFloor.id);
  }

  function handleRemoveFloor(id) {
    if (floors.length <= 1) return;
    if (!confirm('Delete this floor and everything on it?')) return;
    setFloors((prev) => prev.filter((f) => f.id !== id));
    setElements((prev) => prev.filter((e) => e.floorId !== id));
    if (activeFloorId === id) {
      const remaining = floors.filter((f) => f.id !== id);
      setActiveFloorId(remaining[0]?.id || null);
    }
  }

  function updateActiveFloor(patch) {
    setFloors((prev) => prev.map((f) => (f.id === activeFloorId ? { ...f, ...patch } : f)));
  }

  const selectedItem = elements.find((item) => item.id === selectedId) || null;

  const handleUpdateItem = (updatedItem, opts) => {
    setElements((prev) => prev.map((w) => (w.id === updatedItem.id ? updatedItem : w)), opts);
  };

  if (error) return <p className="error page">{error}</p>;
  if (!project || !activeFloor) return <p className="page">Loading…</p>;

  const wallSegments = activeElements.filter((w) => (w.type || 'wall') === 'wall');
  const doorCount = activeElements.filter((w) => w.type === 'door').length;
  const windowCount = activeElements.filter((w) => w.type === 'window').length;
  const ventCount = activeElements.filter((w) => w.type === 'vent').length;
  const pillarCount = activeElements.filter((w) => w.type === 'pillar').length;
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
        <button
          onClick={() => setCurvedMode((c) => !c)}
          title="New walls will be created curved (drag the orange handle after placing to bend them)"
          style={btnStyle(curvedMode)}
        >
          Curved: {curvedMode ? 'On' : 'Off'}
        </button>
        <button onClick={() => setTool('pillar')} style={btnStyle(tool === 'pillar')}>Pillar</button>
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

      {/* Floor bar: switch floors, add/remove, and per-floor settings
          (wall height, roof style, ceiling) for whichever floor is active. */}
      <div style={{ padding: '8px 15px', background: '#181818', color: '#fff', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #2a2a2a' }}>
        {floors.map((f) => (
          <button key={f.id} onClick={() => setActiveFloorId(f.id)} style={btnStyle(f.id === activeFloorId)}>
            {f.name}
          </button>
        ))}
        <button onClick={handleAddFloor} style={iconBtnStyle(true)}>+ Add Floor</button>
        {floors.length > 1 && (
          <button onClick={() => handleRemoveFloor(activeFloorId)} style={{ ...iconBtnStyle(true), color: '#ff6b6b' }}>
            Remove Floor
          </button>
        )}

        <div style={dividerStyle} />

        <label style={floorLabelStyle}>
          Name
          <input
            value={activeFloor.name}
            onChange={(e) => updateActiveFloor({ name: e.target.value })}
            style={floorInputStyle}
          />
        </label>
        <label style={floorLabelStyle}>
          Wall height (cm)
          <input
            type="number"
            value={activeFloor.wallHeight}
            onChange={(e) => updateActiveFloor({ wallHeight: parseFloat(e.target.value) || DEFAULT_WALL_HEIGHT })}
            style={{ ...floorInputStyle, width: '70px' }}
          />
        </label>
        <label style={floorLabelStyle}>
          Roof
          <select
            value={activeFloor.roof}
            onChange={(e) => updateActiveFloor({ roof: e.target.value })}
            style={floorInputStyle}
          >
            <option value="none">None</option>
            <option value="flat">Flat</option>
            <option value="hip">Hip / pitched</option>
          </select>
        </label>
        <label style={{ ...floorLabelStyle, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={activeFloor.ceiling}
            onChange={(e) => updateActiveFloor({ ceiling: e.target.checked })}
          />
          Ceiling
        </label>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {viewMode === '2D' ? (
              <FloorPlanEditor2D
                ref={editor2DRef}
                elements={activeElements}
                tool={tool}
                curvedMode={curvedMode}
                activeFloorId={activeFloorId}
                wallHeight={activeFloor.wallHeight}
                onChange={handleActiveElementsChange}
                onBeginInteraction={beginInteraction}
                selectedId={selectedId}
                onSelect={handleSelect}
                snapEnabled={snapEnabled}
              />
            ) : (
              <Scene3D
                elements={activeElements}
                allElements={elements}
                floors={floors}
                activeFloorId={activeFloorId}
                elevations={floorElevations}
                wallHeight={activeFloor.wallHeight}
                tool={tool}
                curvedMode={curvedMode}
                onChange={handleActiveElementsChange}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </div>
          <div style={statsBarStyle}>
            <span>{activeFloor.name}</span>
            <span>{wallSegments.length} walls</span>
            <span>{pillarCount} pillars</span>
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

const floorLabelStyle = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: '11px',
  color: '#9aa0a6',
  gap: '2px',
};

const floorInputStyle = {
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid #444',
  background: '#1a1a1a',
  color: '#fff',
};
