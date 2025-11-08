// server.js — Render Cloud + Panel Maestro (FIX duplicados + refresco cada 3s + delay 5s desconexión)

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
app.use(express.static("public"));

const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true,
});

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const licPath = path.join(dataDir, "licenses.json");
const serversPath = path.join(dataDir, "servers.json");
const licLogPath = path.join(dataDir, "licencias_usadas.json");

if (!fs.existsSync(licPath)) fs.writeFileSync(licPath, "[]");
if (!fs.existsSync(serversPath)) fs.writeFileSync(serversPath, "[]");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

let androidClients = new Map();
let socketToDevice = new Map();
let panelesLocales = new Map();

function broadcastClients() {
  const list = Array.from(androidClients.values());
  io.emit("updateClientes", list);
  console.log(`📡 Broadcast → ${list.length} dispositivo(s) activo(s).`);
}

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace("::1", "localhost");
}

io.on("connection", (socket) => {
  const ip = socket.handshake.headers["x-forwarded-for"] || socket.conn.remoteAddress || "unknown";
  const cleanIp = sanitizeIp(ip);

  console.log(`🌍 Nueva conexión: ${socket.id} (${cleanIp})`);

  if (androidClients.size > 0) {
    socket.emit("updateClientes", Array.from(androidClients.values()));
  }

  socket.on("connectDevice", (data = {}) => {
    const deviceId = (data.deviceId || `unknown-${socket.id}`).trim();
    socketToDevice.set(socket.id, deviceId);

    if (androidClients.has(deviceId)) {
      const existing = androidClients.get(deviceId);
      existing.socketId = socket.id;
      existing.estado = "online";
      existing.ip = cleanIp;
      existing.ultimaConexion = new Date().toISOString();
      androidClients.set(deviceId, existing);
      console.log(`♻️ Reconexion de ${existing.nombre} (${deviceId})`);
    } else {
      const info = {
        socketId: socket.id,
        deviceId,
        nombre: data.nombre || "Desconocido",
        modelo: data.modelo || "—",
        versionApp: data.versionApp || "—",
        licencia: data.licencia || "-",
        ip: cleanIp,
        estado: "online",
        ultimaConexion: new Date().toISOString(),
      };
      androidClients.set(deviceId, info);
      console.log(`📱 Nuevo Android conectado: ${info.nombre} (${info.licencia})`);
    }

    broadcastClients();
  });

  socket.on("registerPanel", (panelData = {}) => {
    const data = { ...panelData, socketId: socket.id, ultimaSync: new Date().toISOString() };
    panelesLocales.set(socket.id, data);
    console.log(`🧩 Panel local registrado: ${panelData.panelId || socket.id}`);
  });

  socket.on("syncPanel", (data = {}) => {
    panelesLocales.set(socket.id, { ...data, ultimaSync: new Date().toISOString() });
    socket.emit("updateClientes", Array.from(androidClients.values()));
  });

  // ❌ Desconexión con delay de 5s
  socket.on("disconnect", () => {
    if (socketToDevice.has(socket.id)) {
      const deviceId = socketToDevice.get(socket.id);
      socketToDevice.delete(socket.id);

      // Esperar 5 segundos antes de marcar offline
      setTimeout(() => {
        const stillDisconnected = !Array.from(socketToDevice.values()).includes(deviceId);
        if (stillDisconnected && androidClients.has(deviceId)) {
          const c = androidClients.get(deviceId);
          c.estado = "offline";
          c.socketId = null;
          c.ultimaConexion = new Date().toISOString();
          androidClients.set(deviceId, c);
          console.log(`⏱️ Cliente ${c.nombre} (${deviceId}) marcado como OFFLINE tras 5s.`);
          broadcastClients();
        }
      }, 5000);
    }

    if (panelesLocales.has(socket.id)) {
      panelesLocales.delete(socket.id);
      console.log(`⚠️ Panel local desconectado: ${socket.id}`);
    }
  });
});

// 🔁 Refresco automático cada 3 segundos
setInterval(() => {
  if (androidClients.size > 0) {
    io.emit("updateClientes", Array.from(androidClients.values()));
    console.log("🔄 Refresco automático (3s) enviado a todos los paneles.");
  }
}, 3000);

app.get("/api/ping", (_, res) => res.json({ status: "ok", time: new Date() }));
app.get("/api/dispositivos", (_, res) => res.json(Array.from(androidClients.values())));
app.get("/api/paneles", (_, res) => res.json(Array.from(panelesLocales.values())));

app.post("/api/validate-key", (req, res) => {
  try {
    const key = (req.body.key || "").trim();
    const deviceId = (req.body.deviceId || "unknown").trim();
    const nombre = req.body.nombre || "Sin nombre";
    const modelo = req.body.modelo || "—";

    if (!key) return res.status(400).json({ valid: false, error: "Falta la clave" });

    const licencias = readJson(licPath);
    let licencia = licencias.find((l) => (l.key || l) === key);
    if (!licencia) return res.status(403).json({ valid: false, error: "Clave no válida" });

    if (typeof licencia === "string") licencia = { key: licencia };
    if (licencia.usada && licencia.deviceId && licencia.deviceId !== deviceId)
      return res.status(409).json({ valid: false, error: "Licencia ya activada." });

    licencia.usada = true;
    licencia.deviceId = deviceId;
    licencia.nombre = nombre;
    licencia.modelo = modelo;
    licencia.fechaUso = new Date().toISOString();

    const idx = licencias.findIndex((l) => (l.key || l) === key);
    licencias[idx] = licencia;
    saveJson(licPath, licencias);

    // Buscar si ya existe dispositivo con misma licencia
    let existingDeviceId = null;
    for (const [id, c] of androidClients) {
      if (c.licencia === key) {
        existingDeviceId = id;
        break;
      }
    }

    if (existingDeviceId) {
      const existing = androidClients.get(existingDeviceId);
      existing.estado = "autenticado";
      existing.nombre = nombre;
      existing.modelo = modelo;
      existing.ultimaConexion = new Date().toISOString();
      androidClients.set(existingDeviceId, existing);
      console.log(`🔁 Licencia ${key} actualizada en ${existingDeviceId} (sin duplicar).`);
    } else {
      androidClients.set(deviceId, {
        socketId: null,
        deviceId,
        nombre,
        modelo,
        versionApp: "—",
        ip: "Licencia validada desde API",
        licencia: key,
        estado: "autenticado",
        ultimaConexion: new Date().toISOString(),
      });
      console.log(`✅ Nuevo registro de licencia ${key} para ${deviceId}`);
    }

    broadcastClients();

    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(licLogPath, "utf8")); } catch {}
    logs.push({ key, deviceId, nombre, modelo, fechaUso: new Date().toISOString() });
    fs.writeFileSync(licLogPath, JSON.stringify(logs, null, 2));

    res.json({ valid: true, key, status: "ok", message: "Licencia válida", deviceId });
  } catch (err) {
    console.error("⚠️ Error validando licencia:", err);
    res.status(500).json({ valid: false, error: "Error interno del servidor" });
  }
});

app.get("/api/servers", (_, res) => res.json(readJson(serversPath)));

app.post("/api/servers", (req, res) => {
  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: "Faltan campos: name y url" });

  const servers = readJson(serversPath);
  const nuevo = { id: Date.now(), name, url };
  servers.push(nuevo);
  saveJson(serversPath, servers);
  res.json({ success: true, servidor: nuevo });
});

app.post("/api/assign", (req, res) => {
  const { license, serverId } = req.body || {};
  if (!license || !serverId) return res.status(400).json({ error: "Faltan datos" });

  const servers = readJson(serversPath);
  const licencias = readJson(licPath);
  const srv = servers.find((s) => s.id === serverId);
  if (!srv) return res.status(404).json({ error: "Servidor no encontrado" });

  const idx = licencias.findIndex((l) => (l.key || l.license || l) === license);
  if (idx === -1) return res.status(404).json({ error: "Licencia no encontrada" });

  const entry = typeof licencias[idx] === "string" ? { key: licencias[idx] } : licencias[idx];
  entry.key = entry.key || license;
  entry.assignedServer = srv;
  licencias[idx] = entry;
  saveJson(licPath, licencias);

  for (const [, c] of androidClients) {
    if ((c.licencia || c.key) === license && c.socketId) {
      io.to(c.socketId).emit("enviarServidor", { url: srv.url, nombre: srv.name });
      console.log(`📤 Enviado servidor '${srv.name}' a ${c.nombre} (${license})`);
    }
  }

  res.json({ success: true, license, servidor: srv });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️ Servidor Render escuchando en puerto ${PORT}`);
  console.log("✅ FIX duplicados + refresco 3s + delay desconexión 5s aplicado correctamente");
  console.log("======================================");
});
