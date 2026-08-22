import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken } from "../api.js";

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { projects } = await api.listProjects();
      setProjects(projects);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = prompt("Name this home design:", "My New Home");
    if (!name) return;
    const { project } = await api.createProject(name);
    navigate(`/editor/${project.id}`);
  }

  async function handleDelete(id) {
    if (!confirm("Delete this project? This can't be undone.")) return;
    await api.deleteProject(id);
    load();
  }

  function handleLogout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Your homes</h1>
        <div className="header-actions">
          <button onClick={handleCreate}>+ New design</button>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && projects.length === 0 && (
        <p className="empty-state">No designs yet. Create your first floor plan to get started.</p>
      )}

      <div className="project-grid">
        {projects.map((p) => (
          <div key={p.id} className="project-card">
            <h3>{p.name}</h3>
            <p className="muted">Updated {new Date(p.updatedAt).toLocaleString()}</p>
            <div className="card-actions">
              <button onClick={() => navigate(`/editor/${p.id}`)}>Open</button>
              <button className="secondary" onClick={() => handleDelete(p.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
