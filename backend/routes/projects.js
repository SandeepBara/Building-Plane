import { Router } from "express";
import { v4 as uuid } from "uuid";
import { readDB, writeDB } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// Shape of a project's `design` field — this is what the 2D/3D editors read and write.
// {
//   walls:     [{ id, x1, y1, x2, y2, height }],
//   interior:  [{ id, modelUrl, x, y, z, rotationY, scale, label }],
//   exterior:  [{ id, modelUrl, x, y, z, rotationY, scale, label }],
// }
const emptyDesign = { walls: [], interior: [], exterior: [] };

router.get("/", (req, res) => {
  const db = readDB();
  const projects = db.projects
    .filter((p) => p.userId === req.userId)
    .map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }));
  res.json({ projects });
});

router.post("/", (req, res) => {
  const { name } = req.body;
  const db = readDB();

  const project = {
    id: uuid(),
    userId: req.userId,
    name: name || "Untitled Home",
    design: emptyDesign,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.projects.push(project);
  writeDB(db);
  res.status(201).json({ project });
});

router.get("/:id", (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === req.userId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ project });
});

router.put("/:id", (req, res) => {
  const { name, design } = req.body;
  const db = readDB();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === req.userId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (name !== undefined) project.name = name;
  if (design !== undefined) project.design = design;
  project.updatedAt = new Date().toISOString();

  writeDB(db);
  res.json({ project });
});

router.delete("/:id", (req, res) => {
  const db = readDB();
  const before = db.projects.length;
  db.projects = db.projects.filter((p) => !(p.id === req.params.id && p.userId === req.userId));
  if (db.projects.length === before) return res.status(404).json({ error: "Project not found" });
  writeDB(db);
  res.status(204).end();
});

export default router;
