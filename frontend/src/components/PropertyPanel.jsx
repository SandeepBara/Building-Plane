import React, { useRef } from 'react';

export default function PropertyPanel({ selectedItem, onChange, onDelete, onDuplicate, onBeginInteraction = () => {} }) {
  // Tracks whether we've already checkpointed history for the field the
  // user is currently editing, so a burst of keystrokes/slider drags
  // collapses into a single undo step instead of one per change.
  const interactionStartedRef = useRef(false);

  if (!selectedItem) {
    return (
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Properties</h3>
        <p style={{ color: '#888', fontSize: '13px' }}>Select an element to edit properties.</p>
      </div>
    );
  }

  function beginIfNeeded() {
    if (!interactionStartedRef.current) {
      onBeginInteraction();
      interactionStartedRef.current = true;
    }
  }

  function endInteraction() {
    interactionStartedRef.current = false;
  }

  if (selectedItem.type === 'pillar') {
    return (
      <PillarProperties
        item={selectedItem}
        onChange={onChange}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        beginIfNeeded={beginIfNeeded}
        endInteraction={endInteraction}
      />
    );
  }

  return (
    <SegmentProperties
      item={selectedItem}
      onChange={onChange}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      beginIfNeeded={beginIfNeeded}
      endInteraction={endInteraction}
    />
  );
}

function SegmentProperties({ item: selectedItem, onChange, onDelete, onDuplicate, beginIfNeeded, endInteraction }) {
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
    beginIfNeeded();
    const num = parseFloat(val) || 0;
    onChange({ ...selectedItem, [key]: num }, { commit: false });
  };

  const handleRotate = (angleDegDelta) => {
    const cx = (selectedItem.x1 + selectedItem.x2) / 2;
    const cy = (selectedItem.y1 + selectedItem.y2) / 2;
    const halfLen = currentLength / 2;

    const newAngleRad = currentAngleRad + (angleDegDelta * Math.PI) / 180;
    const dx = Math.cos(newAngleRad) * halfLen;
    const dy = Math.sin(newAngleRad) * halfLen;

    // Discrete click -> own undo step (commit defaults to true).
    onChange({
      ...selectedItem,
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy,
    });
  };

  const handleSetAngle = (targetDeg) => {
    beginIfNeeded();
    const cx = (selectedItem.x1 + selectedItem.x2) / 2;
    const cy = (selectedItem.y1 + selectedItem.y2) / 2;
    const halfLen = currentLength / 2;

    const rad = (targetDeg * Math.PI) / 180;
    const dx = Math.cos(rad) * halfLen;
    const dy = Math.sin(rad) * halfLen;

    onChange(
      {
        ...selectedItem,
        x1: cx - dx,
        y1: cy - dy,
        x2: cx + dx,
        y2: cy + dy,
      },
      { commit: false }
    );
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
              onMouseDown={beginIfNeeded}
              onTouchStart={beginIfNeeded}
              onChange={(e) => handleSetAngle(parseFloat(e.target.value))}
              onMouseUp={endInteraction}
              onTouchEnd={endInteraction}
              onBlur={endInteraction}
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
            onFocus={beginIfNeeded}
            onBlur={endInteraction}
            onChange={(e) => {
              beginIfNeeded();
              const newLen = parseFloat(e.target.value) || 1;
              const dx = (selectedItem.x2 - selectedItem.x1) / currentLength;
              const dy = (selectedItem.y2 - selectedItem.y1) / currentLength;
              onChange(
                {
                  ...selectedItem,
                  x2: selectedItem.x1 + dx * newLen,
                  y2: selectedItem.y1 + dy * newLen,
                },
                { commit: false }
              );
            }}
            style={inputStyle}
          />
        </label>
      </div>

      {isWall && (
        <>
          <hr style={{ borderColor: '#444', width: '100%', margin: '5px 0' }} />
          <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={!!selectedItem.curved}
              onFocus={beginIfNeeded}
              onChange={(e) => {
                beginIfNeeded();
                onChange({ ...selectedItem, curved: e.target.checked }, { commit: false });
                endInteraction();
              }}
            />
            Curved wall
          </label>
          {selectedItem.curved && (
            <label style={labelStyle}>
              Bow (px) — drag the orange handle on the wall instead for a more direct feel
              <input
                type="number"
                value={Math.round(selectedItem.bow || 0)}
                onFocus={beginIfNeeded}
                onBlur={endInteraction}
                onChange={(e) => handleDimensionChange('bow', e.target.value)}
                style={inputStyle}
              />
            </label>
          )}
        </>
      )}

      <hr style={{ borderColor: '#444', width: '100%', margin: '5px 0' }} />

      <label style={labelStyle}>
        Height (cm):
        <input
          type="number"
          value={selectedItem.height || 250}
          onFocus={beginIfNeeded}
          onBlur={endInteraction}
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
            onFocus={beginIfNeeded}
            onBlur={endInteraction}
            onChange={(e) => handleDimensionChange('bottomOffset', e.target.value)}
            style={inputStyle}
          />
        </label>
      )}

      <ActionButtons item={selectedItem} onDelete={onDelete} onDuplicate={onDuplicate} />
    </div>
  );
}

function PillarProperties({ item: selectedItem, onChange, onDelete, onDuplicate, beginIfNeeded, endInteraction }) {
  const handleFieldChange = (key, val, opts = { commit: false }) => {
    beginIfNeeded();
    const num = parseFloat(val);
    onChange({ ...selectedItem, [key]: Number.isNaN(num) ? selectedItem[key] : num }, opts);
  };

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Pillar Settings</h3>

      <label style={labelStyle}>
        Shape
        <select
          value={selectedItem.shape || 'round'}
          onChange={(e) => onChange({ ...selectedItem, shape: e.target.value })}
          style={inputStyle}
        >
          <option value="round">Round</option>
          <option value="square">Square</option>
        </select>
      </label>

      <label style={labelStyle}>
        Radius (cm):
        <input
          type="number"
          value={selectedItem.radius || 15}
          onFocus={beginIfNeeded}
          onBlur={endInteraction}
          onChange={(e) => handleFieldChange('radius', e.target.value)}
          style={inputStyle}
        />
      </label>

      <hr style={{ borderColor: '#444', width: '100%', margin: '5px 0' }} />

      <label style={labelStyle}>
        Height (cm):
        <input
          type="number"
          value={selectedItem.height || 250}
          onFocus={beginIfNeeded}
          onBlur={endInteraction}
          onChange={(e) => handleFieldChange('height', e.target.value)}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Elevation / Bottom Offset (cm):
        <input
          type="number"
          value={selectedItem.bottomOffset || 0}
          onFocus={beginIfNeeded}
          onBlur={endInteraction}
          onChange={(e) => handleFieldChange('bottomOffset', e.target.value)}
          style={inputStyle}
        />
      </label>

      <ActionButtons item={selectedItem} onDelete={onDelete} onDuplicate={onDuplicate} />
    </div>
  );
}

function ActionButtons({ item, onDelete, onDuplicate }) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
      <button
        onClick={() => onDuplicate(item.id)}
        title="Duplicate (Ctrl/Cmd+D)"
        style={{ ...inputStyle, flex: 1, background: '#2f6f4f', color: '#fff', cursor: 'pointer' }}
      >
        Duplicate
      </button>
      <button
        onClick={() => onDelete(item.id)}
        title="Delete (Del)"
        style={{ ...inputStyle, flex: 1, background: '#dc3545', color: '#fff', cursor: 'pointer' }}
      >
        Delete
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
  overflowY: 'auto',
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
