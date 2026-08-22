import React from 'react';

export default function PropertyPanel({ selectedItem, onChange, onDelete }) {
  if (!selectedItem) {
    return (
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Properties</h3>
        <p style={{ color: '#888', fontSize: '13px' }}>Select an element to edit properties.</p>
      </div>
    );
  }

  const isWall = (selectedItem.type || 'wall') === 'wall';
  const currentLength = Math.hypot(
    selectedItem.x2 - selectedItem.x1,
    selectedItem.y2 - selectedItem.y1
  );

  const currentAngleRad = Math.atan2(
    selectedItem.y2 - selectedItem.y1,
    selectedItem.x2 - selectedItem.x1
  );
  const currentAngleDeg = Math.round((currentAngleRad * 180) / Math.PI);

  const handleDimensionChange = (key, val) => {
    const num = parseFloat(val) || 0;
    onChange({ ...selectedItem, [key]: num });
  };

  const handleRotate = (angleDegDelta) => {
    const cx = (selectedItem.x1 + selectedItem.x2) / 2;
    const cy = (selectedItem.y1 + selectedItem.y2) / 2;
    const halfLen = currentLength / 2;

    const newAngleRad = currentAngleRad + (angleDegDelta * Math.PI) / 180;
    const dx = Math.cos(newAngleRad) * halfLen;
    const dy = Math.sin(newAngleRad) * halfLen;

    onChange({
      ...selectedItem,
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy,
    });
  };

  const handleSetAngle = (targetDeg) => {
    const cx = (selectedItem.x1 + selectedItem.x2) / 2;
    const cy = (selectedItem.y1 + selectedItem.y2) / 2;
    const halfLen = currentLength / 2;

    const rad = (targetDeg * Math.PI) / 180;
    const dx = Math.cos(rad) * halfLen;
    const dy = Math.sin(rad) * halfLen;

    onChange({
      ...selectedItem,
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy,
    });
  };

  return (
    <div style={panelStyle}>
      <h3 style={{ textTransform: 'capitalize', marginTop: 0 }}>
        {selectedItem.type || 'Wall'} Settings
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: '#61dafb', fontWeight: 'bold' }}>
          Current Length: {Math.round(currentLength)} px
        </span>

        {/* Rotation Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
          <label style={labelStyle}>
            Angle: {currentAngleDeg}°
            <input
              type="range"
              min="-180"
              max="180"
              value={currentAngleDeg}
              onChange={(e) => handleSetAngle(parseFloat(e.target.value))}
            />
          </label>
          <button
            onClick={() => handleRotate(90)}
            style={{ ...inputStyle, background: '#007bff', color: '#fff', cursor: 'pointer' }}
          >
            Rotate 90°
          </button>
        </div>

        <hr style={{ borderColor: '#444', width: '100%', margin: '8px 0' }} />

        <label style={labelStyle}>
          Extend / Shrink End Side (P2):
          <input
            type="number"
            value={Math.round(currentLength)}
            onChange={(e) => {
              const newLen = parseFloat(e.target.value) || 1;
              const dx = (selectedItem.x2 - selectedItem.x1) / currentLength;
              const dy = (selectedItem.y2 - selectedItem.y1) / currentLength;
              onChange({
                ...selectedItem,
                x2: selectedItem.x1 + dx * newLen,
                y2: selectedItem.y1 + dy * newLen,
              });
            }}
            style={inputStyle}
          />
        </label>
      </div>

      <hr style={{ borderColor: '#444', width: '100%', margin: '5px 0' }} />

      <label style={labelStyle}>
        Height (cm):
        <input
          type="number"
          value={selectedItem.height || 250}
          onChange={(e) => handleDimensionChange('height', e.target.value)}
          style={inputStyle}
        />
      </label>

      {!isWall && (
        <label style={labelStyle}>
          Elevation / Bottom Offset (cm):
          <input
            type="number"
            value={selectedItem.bottomOffset || 0}
            onChange={(e) => handleDimensionChange('bottomOffset', e.target.value)}
            style={inputStyle}
          />
        </label>
      )}

      <button
        onClick={() => onDelete(selectedItem.id)}
        style={{ ...inputStyle, background: '#dc3545', color: '#fff', cursor: 'pointer', marginTop: '15px' }}
      >
        Delete Element
      </button>
    </div>
  );
}

const panelStyle = {
  width: '270px',
  background: '#2a2a2a',
  color: '#fff',
  padding: '15px',
  boxSizing: 'border-box',
  borderLeft: '1px solid #444',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  fontSize: '12px',
};

const inputStyle = {
  padding: '6px 8px',
  borderRadius: '4px',
  border: '1px solid #555',
  background: '#1a1a1a',
  color: '#fff',
};