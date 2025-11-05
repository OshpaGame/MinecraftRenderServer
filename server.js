// server.js — Render Cloud + Panel Maestro con:
// - Socket.IO para Android
// - Validación de licencias (/api/validate-key)
// - Catálogo de servidores (/api/servers)
// - Asignación de servidor por licencia (/api/assign)
// - Página web simple en / (public/index.html)

const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // sirve /public/index.html

// ============================
// 🔌 Socket.IO
// ============================
const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true, // compat. Android (socket.io-client 2.x)
});

// ============================
// 📂 Rutas de datos
// ============================
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const licPath       = path.join(dataDir, "licenses.json");
const serversPath   = path.join(dataDir, "servers.json");
const licLogPath    = path.join(dataDir, "licencias_usadas.json");

// Inicializa archivos si no existen
if (!fs.existsSync(licPath))     fs.writeFileSync(licPath, "[]");
if (!fs.existsSync(serversPath)) fs.writeFileSync(serversPath, "[]");

// Helpers para JSON en disco
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// ============================
// 🗂 Estado en memoria
// ============================
let androidClients = new Map();   // socketId -> info cliente
let panelesLocales = new Map();   // (opcional) paneles conectados

function broadcastClients() {
  const list = Array.from(androidClients.values());
  io.emit("updateClientes", list);
  console.log(`📡 Broadcast Render → ${list.length} dispositivo(s) activo(s).`);
}

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace("::1", "localhost");
}

// ============================
// ⚙️ Eventos Socket.IO
// ============================
io.on("connection", (socket) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.conn.remoteAddress ||
    "unknown";
  const cleanIp = sanitizeIp(ip);

  console.log(`🌍 Nueva conexión: ${socket.id} (${cleanIp})`);

  // 📱 Cliente Android se registra
  socket.on("connectDevice", (data = {}) => {
    const info = {
      socketId: socket.id,
      deviceId: data.deviceId || `unknown-${socket.id}`,
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      licencia: data.licencia || "-",         // 👈 IMPORTANTE: licencia
      ip: cleanIp,
      estado: "online",
      ultimaConexion: new Date().toISOString(),
    };
    androidClients.set(socket.id, info);
    console.log(`📱 Android conectado: ${info.nombre} (${info.licencia})`);
    broadcastClients();
  });

  // 🧠 Registro de panel local (opcional)
  socket.on("registerPanel", (panelData = {}) => {
    const data = {
      ...panelData,
      socketId: socket.id,
      ultimaSync: new Date().toISOString(),
    };
    panelesLocales.set(socket.id, data);
    console.log(`🧩 Panel local registrado: ${panelData.panelId || socket.id}`);
  });

  socket.on("syncPanel", (data = {}) => {
    panelesLocales.set(socket.id, { ...data, ultimaSync: new Date().toISOString() });
    console.log(`🔁 Sync de panel "${data.nombre}"`);
    socket.emit("updateClientes", Array.from(androidClients.values()));
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    if (androidClients.has(socket.id)) {
      const c = androidClients.get(socket.id);
      c.estado = "offline";
      androidClients.delete(socket.id);
      console.log(`❌ Cliente Android desconectado: ${c.nombre} (${c.deviceId})`);
      broadcastClients();
    }
    if (panelesLocales.has(socket.id)) {
      panelesLocales.delete(socket.id);
      console.log(`⚠️ Panel local desconectado: ${socket.id}`);
    }
  });
});

// ============================
// 🌍 Endpoints básicos
// ============================
app.get("/api/ping", (_, res) => res.json({ status: "ok", time: new Date() }));
app.get("/api/dispositivos", (_, res) => res.json(Array.from(androidClients.values())));
app.get("/api/paneles", (_, res) => res.json(Array.from(panelesLocales.values())));

// ============================
// 🔑 Licencias (validación + asignación)
// ============================

// 🔍 Ver licencias (debug)
app.get("/api/licencias", (_, res) => {
  try {
    const list = readJson(licPath);
    res.json({ total: list.length, sample: list.slice(0, 3) });
  } catch (err) {
    res.status(500).json({ error: "Error al leer licencias", message: err.message });
  }
});

// ✅ Validar clave (se mantiene para tu LoginActivity)
app.post("/api/validate-key", (req, res) => {
  try {
    const key = (req.body.key || "").trim();
    const deviceId = req.body.deviceId || "unknown";
    const nombre   = req.body.nombre   || "Sin nombre";
    const modelo   = req.body.modelo   || "—";

    if (!key) return res.status(400).json({ valid: false, error: "Falta la clave" });

    const licencias = readJson(licPath);

    // Compatibilidad: puede ser arreglo de strings o de objetos {key,...}
    let licencia = licencias.find((l) => (l.key || l) === key);
    if (!licencia) {
      console.log(`❌ Intento con clave inválida: ${key}`);
      return res.status(403).json({ valid: false, error: "Clave no válida" });
    }

    // Normaliza a objeto
    if (typeof licencia === "string") {
      licencia = { key: licencia };
    }

    // Si ya está usada por otro device
    if (licencia.usada && licencia.deviceId && licencia.deviceId !== deviceId) {
      console.log(`⚠️ Clave ${key} ya está en uso por otro dispositivo (${licencia.deviceId}).`);
      return res.status(409).json({
        valid: false,
        error: "Esta licencia ya está activada en otro dispositivo.",
      });
    }

    // Marca como usada/actualiza datos
    licencia.usada = true;
    licencia.deviceId = deviceId;
    licencia.nombre = nombre;
    licencia.modelo = modelo;
    licencia.fechaUso = new Date().toISOString();

    // Reemplaza/actualiza en array
    const idx = licencias.findIndex((l) => (l.key || l) === key);
    licencias[idx] = licencia;
    saveJson(licPath, licencias);

    console.log(`🔑 Licencia válida usada: ${key} por ${nombre} (${deviceId})`);

    // Registra/actualiza en la lista en memoria
    const info = {
      socketId: deviceId, // si aún no está por socket, usamos deviceId como clave temporal
      deviceId,
      nombre,
      modelo,
      versionApp: "—",
      ip: "Licencia validada desde API",
      licencia: key,
      estado: "autenticado",
      ultimaConexion: new Date().toISOString(),
    };
    androidClients.set(deviceId, info);
    broadcastClients();

    // Log histórico aparte
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(licLogPath, "utf8")); } catch {}
    logs.push({ key, deviceId, nombre, modelo, fechaUso: new Date().toISOString() });
    fs.writeFileSync(licLogPath, JSON.stringify(logs, null, 2));

    return res.json({ valid: true, key, status: "ok", message: "Licencia válida", deviceId });
  } catch (err) {
    console.error("⚠️ Error validando licencia:", err);
    return res.status(500).json({ valid: false, error: "Error interno del servidor" });
  }
});

// ============================
// 📦 Catálogo de servidores (panel)
// ============================

// Listar servidores
app.get("/api/servers", (_, res) => res.json(readJson(serversPath)));

// Agregar servidor (name + url)
app.post("/api/servers", (req, res) => {
  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: "Faltan campos: name y url" });

  const servers = readJson(serversPath);
  const nuevo = { id: Date.now(), name, url };
  servers.push(nuevo);
  saveJson(serversPath, servers);

  console.log(`📦 Nuevo servidor registrado: ${name}`);
  res.json({ success: true, servidor: nuevo });
});

// ============================
// 🔗 Asignación por licencia
// ============================

// Asignar servidor a una licencia
app.post("/api/assign", (req, res) => {
  const { license, serverId } = req.body || {};
  if (!license || !serverId) return res.status(400).json({ error: "Faltan datos" });

  const servers = readJson(serversPath);
  const licencias = readJson(licPath);
  const srv = servers.find((s) => s.id === serverId);
  if (!srv) return res.status(404).json({ error: "Servidor no encontrado" });

  // Busca la licencia (debe existir en licenses.json)
  const idx = licencias.findIndex((l) => (l.key || l.license || l) === license);
  if (idx === -1) return res.status(404).json({ error: "Licencia no encontrada en licenses.json" });

  // Normaliza a objeto
  const entry = typeof licencias[idx] === "string" ? { key: licencias[idx] } : licencias[idx];

  entry.key = entry.key || license;
  entry.assignedServer = srv; // 👈 aquí guardamos la asignación
  licencias[idx] = entry;
  saveJson(licPath, licencias);

  console.log(`🔗 Servidor '${srv.name}' asignado a licencia ${license}`);

  // Si el dispositivo con esa licencia está online → envía ya
  for (const [, c] of androidClients) {
    if ((c.licencia || c.key) === license) {
      io.to(c.socketId).emit("enviarServidor", { url: srv.url, nombre: srv.name });
      console.log(`📤 Enviado servidor '${srv.name}' a ${c.nombre} (${license})`);
    }
  }

  res.json({ success: true, license, servidor: srv });
});

// Obtener servidor asignado por licencia (Android puede consultar)
app.get("/api/assigned/:license", (req, res) => {
  const license = req.params.license;
  const licencias = readJson(licPath);
  const entry = licencias.find((l) => (l.key || l.license || l) === license);
  if (!entry || !entry.assignedServer) return res.json({ assigned: null });
  res.json({ assigned: entry.assignedServer });
});

// ============================
// 🚀 Inicialización
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️ Servidor Render escuchando en puerto ${PORT}`);
  console.log("✅ Login (/api/validate-key) + Catálogo (/api/servers) + Asignación (/api/assign) OK");
  console.log("======================================");
});
