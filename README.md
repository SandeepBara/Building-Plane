# Home Design Studio — Starter Project

A starter scaffold for a home naksha (floor plan) + 3D model + interior/exterior design tool,
with user accounts and saved projects. This is deliberately minimal so you can see the whole
flow end-to-end, then build outward from it.

## What's included

- **Backend** (`/backend`) — Node.js + Express API
  - Register / login with JWT auth (passwords hashed with bcrypt)
  - Save / load projects per user
  - Data stored in a local JSON file (`backend/data/db.json`) so it runs with zero setup —
    swap this for PostgreSQL or MongoDB once you're past prototyping (see `db.js`)
- **Frontend** (`/frontend`) — React + Vite
  - Login / register screen
  - Dashboard listing your saved home designs
  - Editor with two modes:
    - **2D Naksha** — draw walls on a grid using Fabric.js (click-drag to draw, click + Delete to remove)
    - **3D View** — Three.js scene that extrudes your 2D walls into a 3D model you can orbit around

This covers the full loop: **draw a floor plan → generate a 3D model → save it under your account
→ reload it later.** Interior/exterior furniture placement (Step 5–6 from the plan) is the next
piece to build on top of this — the `design` object already has empty `interior` and `exterior`
arrays ready for that.

### Editor functionality added on top of the original scaffold

- **Undo / Redo** — every wall/door/window/vent edit (draw, move, resize, rotate, delete,
  duplicate) is undoable. Drags and rapid field edits collapse into a single undo step instead of
  one per pixel/keystroke. Toolbar buttons + `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`).
  See `frontend/src/hooks/useHistory.js`.
- **Duplicate** — clone the selected element a short offset away, via the Property Panel's
  "Duplicate" button or `Ctrl/Cmd+D`.
- **Keyboard shortcuts** — `Delete`/`Backspace` deletes the selected element, `Escape` clears the
  selection and returns to the Select tool (ignored while typing in a text field).
- **Snap to grid** — toggle in the toolbar; new walls, dragged endpoints, and moved walls snap to
  the 20px/1m grid in the 2D editor.
- **Live length readout** — while drawing a wall in 2D, the in-progress length is shown in meters.
- **Stats bar** — live count of walls/doors/windows/vents and total wall length under the canvas.
- **Export PNG** — download the current 2D floor plan as a PNG image.
- **Unsaved-changes protection** — the Save button shows a dirty indicator, and you're warned
  before navigating back or closing the tab with unsaved edits.

## Running it locally

You'll need [Node.js](https://nodejs.org) 18+ installed.

**1. Start the backend**
```bash
cd backend
npm install
npm start
```
This runs the API at `http://localhost:4000`.

**2. Start the frontend** (in a separate terminal)
```bash
cd frontend
npm install
npm run dev
```
This opens the app at `http://localhost:5173`.

**3. Use it**
- Register an account
- Create a new design from the dashboard
- Draw a few walls in "2D Naksha" mode
- Switch to "3D View" to see them extruded into a model
- Hit **Save**

## Where to go next

1. **Interior/exterior items** — add a furniture panel that lets users drag `.glb` models into
   the 3D scene (use `GLTFLoader` from `three/examples/jsm/loaders/GLTFLoader.js`), storing each
   item's position/rotation in `design.interior` / `design.exterior`.
2. **Real database** — replace `backend/db.js` with PostgreSQL (`pg`) or MongoDB (`mongoose`).
   The `readDB()`/`writeDB()` shape is intentionally simple to swap out.
3. **Rooms, not just walls** — detect closed wall loops to calculate room area and let users
   assign room types (bedroom, kitchen, etc.) and floor materials per room.
4. **Doors & windows** — add cutout geometry where a door/window is placed on a wall.
5. **Export** — render the 3D scene to an image, or export the floor plan as a PDF.
6. **Furniture library & performance** — once you have many 3D models, use `InstancedMesh` and
   compressed `.glb` files (Draco) to keep the scene fast.

## Notes

- Auth uses a hardcoded dev JWT secret in `middleware/auth.js` — set a real `JWT_SECRET`
  environment variable before deploying anywhere.
- The 2D→3D coordinate scale is a rough approximation (`PX_TO_METERS` in `Scene3D.jsx`) —
  tune it once you decide on a real-world unit system (e.g. 1 grid cell = 0.5m).
