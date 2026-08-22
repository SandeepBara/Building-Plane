const BASE_URL = "http://localhost:4000/api";

function getToken() {
  return localStorage.getItem("token");
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  register: (name, email, password) =>
    request("/auth/register", { method: "POST", body: { name, email, password } }),
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } }),

  listProjects: () => request("/projects"),
  createProject: (name) => request("/projects", { method: "POST", body: { name } }),
  getProject: (id) => request(`/projects/${id}`),
  saveProject: (id, { name, design }) =>
    request(`/projects/${id}`, { method: "PUT", body: { name, design } }),
  deleteProject: (id) => request(`/projects/${id}`, { method: "DELETE" }),
};

export function setToken(token) {
  localStorage.setItem("token", token);
}
export function clearToken() {
  localStorage.removeItem("token");
}
export function isLoggedIn() {
  return !!getToken();
}
