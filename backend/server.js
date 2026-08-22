import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "5mb" })); // design JSON can get sizable with many walls/items

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Home Design API running on http://localhost:${PORT}`);
});
