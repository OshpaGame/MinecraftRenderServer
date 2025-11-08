// server.js — Render Cloud + Panel Maestro
// ZIP Upload + Refresco 3s + Delay 5s desconexión
// + Limpieza de licencias + Contador licencias activas
// + /api/validate-key RESTAURADO (compat Android)
// + Asignación envia {zip,url} para compatibilidad

const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// 🚫 Anti-Cache extremo para Render y navegadores
const optionsNoCache = {
  setHeaders: (res, p) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  },
};

// Sirve los archivos públicos SIN caché
app.use(express.static(path.join(__dirname, "public"), optionsNoCache));

// Forzar gestor.html a ser servido SIEMPRE desde disco
app.get("/gestor.html", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "gestor.html"));
});

const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true,
});

// ============================
// 📂 Directorios y JSON
// ============================
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const uploadsDir = path.join(dataDir, "servers_uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const licPath = path.join(dataDir, "licenses.json");
const serversPath = path.join(dataDir, "servers.json");
const licLogPath = path.join(dataDir, "licencias_usadas.json");

if (!fs.existsSync(licPath)) fs.writeFileSync(licPath, "[]");
if (!fs.existsSync(serversPath)) fs.writeFileSync(serversPath, "[]");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// ============================
// 🔌 Mapas de conexión
// ============================
let androidClients = new Map();   // deviceId -> info
let socketToDevice = new Map();   // socketId -> deviceId
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

// ============================
// ⚡ Socket.IO
// ============================
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
      existing.licencia = data.licencia || existing.licencia || "-";
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

  // ❌ Desconexión con delay 5s
  socket.on("disconnect", () => {
    if (socketToDevice.has(socket.id)) {
      const deviceId = socketToDevice.get(socket.id);
      socketToDevice.delete(socket.id);

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

// 🔁 Refresco cada 3 segundos
setInterval(() => {
  if (androidClients.size > 0) {
    io.emit("updateClientes", Array.from(androidClients.values()));
    console.log("🔄 Refresco automático (3s) enviado a todos los paneles.");
  }
}, 3000);

// ============================
// 📦 Subida de servidores ZIP
// ============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/zip" && !file.originalname.endsWith(".zip")) {
      return cb(new Error("Solo se permiten archivos .zip"));
    }
    cb(null, true);
  },
});

// 📋 Listar servidores (con contador de licencias activas)
app.get("/api/servers", (_, res) => {
  const servers = readJson(serversPath);
  const licencias = readJson(licPath);

  const enriched = servers.map((s) => {
    const count = licencias.filter(
      (l) => l.assignedServer && l.assignedServer.id === s.id
    ).length;
    return { ...s, assignedCount: count };
  });

  res.json(enriched);
});

// Subir servidor ZIP
app.post("/api/servers", upload.single("serverZip"), (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !req.file) return res.status(400).json({ error: "Faltan datos: nombre o ZIP." });

    const servers = readJson(serversPath);
    const nuevo = {
      id: Date.now(),
      name,
      file: path.relative(__dirname, req.file.path),
      sizeMB: (req.file.size / (1024 * 1024)).toFixed(2) + " MB",
    };

    servers.push(nuevo);
    saveJson(serversPath, servers);

    console.log(`📦 Servidor ZIP '${nuevo.name}' subido (${nuevo.sizeMB})`);
    res.json({ success: true, servidor: nuevo });
  } catch (err) {
    console.error("❌ Error al subir servidor:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// 📥 Descargar ZIP
app.get("/api/download", (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: "Falta la ruta del archivo" });
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Archivo no encontrado" });
  res.download(fullPath);
});

// 🗑️ Eliminar servidor ZIP + limpiar licencias asociadas
app.delete("/api/deleteServer/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let servers = readJson(serversPath);
    let licencias = readJson(licPath);

    const index = servers.findIndex((s) => s.id === id);
    if (index === -1) return res.status(404).json({ error: "Servidor no encontrado" });

    const filePath = path.join(__dirname, servers[index].file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    servers.splice(index, 1);
    saveJson(serversPath, servers);

    // limpiar referencias en licencias
    let cambios = 0;
    licencias = licencias.map((l) => {
      const entry = typeof l === "string" ? { key: l } : l;
      if (entry.assignedServer && entry.assignedServer.id === id) {
        delete entry.assignedServer;
        cambios++;
      }
      return entry;
    });
    if (cambios > 0) saveJson(licPath, licencias);

    console.log(`🗑️ Servidor ID ${id} eliminado (${cambios} licencia(s) limpiada(s)).`);
    res.json({ success: true, removed: id, cleanedLicenses: cambios });
  } catch (err) {
    console.error("❌ Error al eliminar servidor:", err);
    res.status(500).json({ error: "Error interno al eliminar servidor" });
  }
});

// ============================
// 🔑 VALIDAR LICENCIA (RESTABLECIDO)
// ============================
app.post("/api/validate-key", (req, res) => {
  try {
    const key = (req.body.key || "").trim();
    const deviceId = (req.body.deviceId || "unknown").trim();
    const nombre = req.body.nombre || "Sin nombre";
    const modelo = req.body.modelo || "—";

    if (!key) return res.status(400).json({ valid: false, error: "Falta la clave" });

    const licencias = readJson(licPath);
    let licencia = licencias.find((l) => (l.key || l) === key);
    if (!licencia) {
      console.log(`❌ Intento con clave inválida: ${key}`);
      return res.status(403).json({ valid: false, error: "Clave no válida" });
    }
    if (typeof licencia === "string") licencia = { key: licencia };

    if (licencia.usada && licencia.deviceId && licencia.deviceId !== deviceId) {
      console.log(`⚠️ Clave ${key} ya en uso por otro dispositivo.`);
      return res.status(409).json({ valid: false, error: "Licencia ya activada en otro dispositivo." });
    }

    licencia.usada = true;
    licencia.deviceId = deviceId;
    licencia.nombre = nombre;
    licencia.modelo = modelo;
    licencia.fechaUso = new Date().toISOString();

    const idx = licencias.findIndex((l) => (l.key || l) === key);
    licencias[idx] = licencia;
    saveJson(licPath, licencias);

    if (androidClients.has(deviceId)) {
      const existing = androidClients.get(deviceId);
      existing.licencia = key;
      existing.estado = "autenticado";
      existing.ultimaConexion = new Date().toISOString();
      androidClients.set(deviceId, existing);
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

// ============================
// 🎯 Asignación de servidor a licencia (mejorada)
// ============================
app.post("/api/assign", (req, res) => {
  try {
    const { license, serverId } = req.body || {};
    if (!license || !serverId) {
      console.warn("⚠️ /api/assign: faltan datos", req.body);
      return res.status(400).json({ error: "Faltan datos: license o serverId" });
    }

    const servers = readJson(serversPath);
    const licencias = readJson(licPath);
    const srv = servers.find((s) => s.id === serverId || s.id === Number(serverId));
    if (!srv) {
      console.warn("⚠️ /api/assign: servidor no encontrado", serverId);
      return res.status(404).json({ error: "Servidor no encontrado" });
    }

    const idx = licencias.findIndex((l) => (l.key || l.license || l) === license);
    if (idx === -1) {
      console.warn("⚠️ /api/assign: licencia no encontrada", license);
      return res.status(404).json({ error: "Licencia no encontrada" });
    }

    const entry = typeof licencias[idx] === "string" ? { key: licencias[idx] } : licencias[idx];
    entry.key = entry.key || license;
    entry.assignedServer = srv;
    licencias[idx] = entry;
    saveJson(licPath, licencias);

    // Buscar cliente online
    let found = false;
    for (const [, c] of androidClients) {
      if ((c.licencia || c.key) === license && c.socketId) {
        io.to(c.socketId).emit("enviarServidor", {
          zip: srv.file,
          url: null,
          nombre: srv.name,
          sizeMB: srv.sizeMB,
          trigger: "auto",
        });
        console.log(`📤 (Asignar) ZIP '${srv.name}' enviado a ${c.nombre} (${license})`);
        found = true;
      }
    }

    if (!found) {
      console.warn(`⚠️ /api/assign: no hay dispositivo online con licencia ${license}`);
    }

    console.log(`✅ /api/assign completado: licencia=${license}, servidor=${srv.name}`);
    res.json({
      success: true,
      license,
      servidor: srv,
      sent: found,
      message: found ? "Servidor enviado al dispositivo" : "Servidor asignado (dispositivo offline)",
    });
  } catch (err) {
    console.error("❌ Error en /api/assign:", err);
    res.status(500).json({ error: "Error interno al asignar servidor" });
  }
});


// ============================
// 🚀 NUEVO: Enviar ZIP “a demanda” al dispositivo por licencia
// ============================
app.post("/api/sendToDevice", (req, res) => {
  try {
    const { license, serverId } = req.body || {};
    if (!license || !serverId) return res.status(400).json({ error: "Faltan datos" });

    const servers = readJson(serversPath);
    const srv = servers.find((s) => s.id === serverId);
    if (!srv) return res.status(404).json({ error: "Servidor no encontrado" });

    let sent = false;
    for (const [, c] of androidClients) {
      if ((c.licencia || c.key) === license && c.socketId) {
        io.to(c.socketId).emit("enviarServidor", {
          zip: srv.file,
          url: null,
          nombre: srv.name,
          sizeMB: srv.sizeMB,
          trigger: "manual"
        });
        console.log(`📤 (Manual) ZIP '${srv.name}' enviado a ${c.nombre} (${license})`);
        sent = true;
      }
    }
    if (!sent) {
      return res.status(404).json({ error: "No hay dispositivo online con esa licencia" });
    }
    res.json({ success: true, message: "Enviado al dispositivo", servidor: srv, license });
  } catch (e) {
    console.error("❌ Error en /api/sendToDevice:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

// (Opcional) Lista de clientes por HTTP
app.get("/api/clients", (req, res) => {
  res.json(Array.from(androidClients.values()));
});

// Consultar servidor asignado a una licencia
app.get("/api/assigned/:license", (req, res) => {
  const license = req.params.license;
  const licencias = readJson(licPath);
  const entry = licencias.find((l) => (l.key || l.license || l) === license);
  if (!entry || !entry.assignedServer) return res.json({ assigned: null });

  const srv = entry.assignedServer;
  res.json({
    assigned: {
      id: srv.id,
      name: srv.name,
      zip: srv.file,
      url: null,
      sizeMB: srv.sizeMB,
      download: `/api/download?file=${encodeURIComponent(srv.file)}`
    }
  });
});

// ============================
// 🚀 Inicio del servidor
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️ Servidor Render escuchando en puerto ${PORT}`);
  console.log("✅ ZIP Upload + contador licencias + limpieza + validate-key + delay 5s + refresco 3s OK");
  console.log("======================================");
});
