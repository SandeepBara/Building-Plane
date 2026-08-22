import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import FloorPlanEditor2D from "../components/FloorPlanEditor2D.jsx";
import Scene3D from "../components/Scene3D.jsx";

export default function Editor() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [view, setView] = useState("2d");
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");

  // Tools & Selection State — shared between the 2D and 3D views so
  // selecting/deleting something in one view is reflected in the other.
  const [activeTool, setActiveTool] = useState("wall"); // 'wall', 'door', 'window', 'vent', 'select', etc.
  const [activeColor, setActiveColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState(null);
  const [activeAction, setActiveAction] = useState(null);

  const hasSelection = Boolean(selectedId);

  useEffect(() => {
    api
      .getProject(projectId)
      .then(({ project }) => {
        const initialWalls = Array.isArray(project?.design?.walls)
          ? project.design.walls
          : [];

        setProject({
          ...project,
          design: {
            ...project?.design,
            walls: initialWalls,
          },
        });
      })
      .catch((err) => setError(err.message));
  }, [projectId]);

  const handleWallsChange = useCallback((walls) => {
    setProject((prev) =>
      prev ? { ...prev, design: { ...prev.design, walls } } : prev
    );
  }, []);

  // Always sets the clicked tool — a toolbar should always have exactly one
  // active tool. (Previously this toggled the tool off to `null` on a
  // second click, which silently broke selection: with no tool matching
  // 'select', clicks in the canvas fell through to the drawing branch
  // instead of selecting anything.)
  const handleToolClick = (toolName) => {
    setActiveTool(toolName);
  };

  // Deletes the selected item. If it's a wall, also removes any
  // door/window/vent that was cut into it — they can't float on their own.
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setActiveAction("delete");
    setProject((prev) => {
      if (!prev) return prev;
      const current = Array.isArray(prev.design?.walls) ? prev.design.walls : [];
      const target = current.find((w) => w.id === selectedId);
      const next =
        target && (target.type || "wall") === "wall"
          ? current.filter((w) => w.id !== selectedId && w.wallId !== selectedId)
          : current.filter((w) => w.id !== selectedId);
      return { ...prev, design: { ...prev.design, walls: next } };
    });
    setSelectedId(null);
    setTimeout(() => setActiveAction(null), 150);
  }, [selectedId]);

  const handleClearAll = useCallback(() => {
    setActiveAction("clear");
    setProject((prev) =>
      prev ? { ...prev, design: { ...prev.design, walls: [] } } : prev
    );
    setSelectedId(null);
    setTimeout(() => setActiveAction(null), 150);
  }, []);

  const getToolBtnStyle = (toolName) => {
    const isActive = activeTool === toolName;
    return {
      padding: "6px 12px",
      borderRadius: "4px",
      border: isActive ? "2px solid #0056b3" : "1px solid #ccc",
      backgroundColor: isActive ? "#007bff" : "#ffffff",
      color: isActive ? "#ffffff" : "#333333",
      fontWeight: isActive ? "bold" : "normal",
      cursor: "pointer",
      boxShadow: isActive ? "0 2px 4px rgba(0,0,0,0.2)" : "none",
      transition: "all 0.15s ease",
    };
  };

  const getActionBtnStyle = (actionType, defaultBg, activeBg, isDisabled = false) => {
    const isActive = activeAction === actionType;
    return {
      padding: "6px 12px",
      borderRadius: "4px",
      border: isActive ? "2px solid #000" : "1px solid #ccc",
      backgroundColor: isDisabled ? "#cccccc" : isActive ? activeBg : defaultBg,
      color: isDisabled ? "#888888" : "#ffffff",
      fontWeight: isActive ? "bold" : "normal",
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.6 : 1,
      boxShadow: isActive ? "inset 0 2px 4px rgba(0,0,0,0.4)" : "none",
      transition: "all 0.1s ease",
    };
  };

  async function handleSave() {
    if (!project) return;
    setSaveState("saving");
    try {
      await api.saveProject(project.id, { name: project.name, design: project.design });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      setError(err.message);
      setSaveState("error");
    }
  }

  if (error) return <p className="error page">{error}</p>;
  if (!project) return <p className="page">Loading…</p>;

  const currentWalls = Array.isArray(project?.design?.walls) ? project.design.walls : [];

  return (
    <div className="page editor-page">
      <header className="page-header">
        <button className="link-button" onClick={() => navigate("/")}>
          ← Back
        </button>
        <input
          className="project-name-input"
          value={project?.name || ""}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <div className="header-actions">
          <div className="view-toggle">
            <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>
              2D Naksha (Paint)
            </button>
            <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
              3D View
            </button>
          </div>
          <button onClick={handleSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save"}
          </button>
        </div>
      </header>

      <div
        className="paint-toolbar"
        style={{
          display: "flex",
          gap: "10px",
          padding: "10px 20px",
          background: "#e0e0e0",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
          <button
            style={getToolBtnStyle("select")}
            onClick={() => handleToolClick("select")}
          >
            ✂️ Select & Drag
          </button>
          <button
            style={getToolBtnStyle("wall")}
            onClick={() => handleToolClick("wall")}
          >
            🧱 Wall
          </button>
          <button
            style={getToolBtnStyle("door")}
            onClick={() => handleToolClick("door")}
          >
            🚪 Door
          </button>
          <button
            style={getToolBtnStyle("window")}
            onClick={() => handleToolClick("window")}
          >
            🪟 Window
          </button>
          <button
            style={getToolBtnStyle("vent")}
            onClick={() => handleToolClick("vent")}
          >
            💨 Vent
          </button>
          <button
            style={getToolBtnStyle("rect")}
            onClick={() => handleToolClick("rect")}
            disabled={view === "3d"}
            title={view === "3d" ? "Switch to 2D Naksha to draw a room rectangle" : ""}
          >
            🔲 Room (Rect)
          </button>
          <button
            style={getToolBtnStyle("eraser")}
            onClick={() => handleToolClick("eraser")}
            title={view === "3d" ? "Click a wall/door/window to delete it" : ""}
          >
            🧹 Eraser
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "5px",
            borderLeft: "1px solid #ccc",
            paddingLeft: "10px",
          }}
        >
          <button
            disabled={!hasSelection}
            onClick={handleDeleteSelected}
            style={getActionBtnStyle("delete", "#ff9800", "#e68a00", !hasSelection)}
          >
            ❌ Delete Selected
          </button>
          <button
            onClick={handleClearAll}
            style={getActionBtnStyle("clear", "#ff4d4d", "#cc0000")}
          >
            🗑️ Clear All
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          Color:
          <input
            type="color"
            value={activeColor}
            onChange={(e) => setActiveColor(e.target.value)}
            disabled={activeTool === "eraser"}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          Thickness:
          <input
            type="range"
            min="1"
            max="20"
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
          />
          <span>{strokeWidth}px</span>
        </label>

        {view === "3d" && (
          <span style={{ fontSize: "13px", color: "#555" }}>
            {activeTool === "wall"
              ? "Click the floor twice to draw a wall (start, then end)."
              : activeTool === "door" || activeTool === "window" || activeTool === "vent"
              ? "Click a wall to cut an opening into it."
              : activeTool === "select"
              ? "Click a wall/door/window to select it."
              : activeTool === "eraser"
              ? "Click a wall/door/window to delete it."
              : ""}
          </span>
        )}
      </div>

      <div className="editor-canvas-area">
        {view === "2d" ? (
          <FloorPlanEditor2D
            walls={currentWalls}
            onChange={handleWallsChange}
            tool={activeTool}
            color={activeColor}
            lineWidth={strokeWidth}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDeleteSelected={handleDeleteSelected}
          />
        ) : (
          <Scene3D
            walls={currentWalls}
            tool={activeTool}
            color={activeColor}
            lineWidth={strokeWidth}
            onChange={handleWallsChange}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}