import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FloorPlanEditor2D from '../components/FloorPlanEditor2D';
import Scene3D from '../components/Scene3D';
import PropertyPanel from '../components/PropertyPanel';
import { api } from '../api.js';

export default function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [walls, setWalls] = useState([]);
  const [tool, setTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode, setViewMode] = useState('2D');
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle');

  // Load project & populate local walls state
  useEffect(() => {
    api
      .getProject(projectId)
      .then(({ project }) => {
        const initialWalls = Array.isArray(project?.design?.walls)
          ? project.design.walls
          : [];

        setProject(project);
        setWalls(initialWalls);
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

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
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setError(err.message);
      setSaveState('error');
    }
  }

  const selectedItem = walls.find((item) => item.id === selectedId) || null;

  const handleUpdateItem = (updatedItem) => {
    setWalls((prev) => prev.map((w) => (w.id === updatedItem.id ? updatedItem : w)));
  };

  const handleDeleteItem = (id) => {
    // Delete item & remove attached openings if a parent wall is deleted
    setWalls((prev) => prev.filter((w) => w.id !== id && w.wallId !== id));
    if (selectedId === id) setSelectedId(null);
  };

  if (error) return <p className="error page">{error}</p>;
  if (!project) return <p className="page">Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#121212' }}>
      <div style={{ padding: '10px 15px', background: '#1e1e1e', color: '#fff', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button className="link-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <input
          className="project-name-input"
          value={project?.name || ''}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <button onClick={handleSave} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
        </button>
        <button onClick={() => setViewMode('2D')} style={btnStyle(viewMode === '2D')}>2D View</button>
        <button onClick={() => setViewMode('3D')} style={btnStyle(viewMode === '3D')}>3D View</button>

        <div style={{ width: '1px', height: '20px', background: '#444', margin: '0 8px' }} />

        <button onClick={() => setTool('select')} style={btnStyle(tool === 'select')}>Select / Move</button>
        <button onClick={() => setTool('wall')} style={btnStyle(tool === 'wall')}>Wall</button>
        <button onClick={() => setTool('door')} style={btnStyle(tool === 'door')}>Door</button>
        <button onClick={() => setTool('window')} style={btnStyle(tool === 'window')}>Window</button>
        <button onClick={() => setTool('vent')} style={btnStyle(tool === 'vent')}>Vent</button>
        <button onClick={() => setTool('eraser')} style={btnStyle(tool === 'eraser')}>Eraser</button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          {viewMode === '2D' ? (
            <FloorPlanEditor2D
              walls={walls}
              tool={tool}
              onChange={setWalls}
              selectedId={selectedId}
              onSelect={handleSelect}
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

        <PropertyPanel
          selectedItem={selectedItem}
          onChange={handleUpdateItem}
          onDelete={handleDeleteItem}
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