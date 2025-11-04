// server.js - Backend Render (conexión nube entre panel y apps Android)
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true,
});

const PORT = process.env.PORT || 3000;

// ============================
// ESTADO DE PANEL Y CLIENTES
// ============================
let panels = new Map();   // panelId -> info
let clients = new Map();  // socketId -> info (app Android)

// ============================
// SOCKET.IO - Render Global
// ============================
io.on("connection", (socket) => {
  console.log(`🌐 Nueva conexión global (${socket.id})`);

  // 🖥️ Panel Maestro se registra
  socket.on("registerPanel", (data) => {
    if (!data?.panelId) return;
    panels.set(data.panelId, {
      socketId: socket.id,
      lastPing: new Date().toISOString(),
    });
    console.log(`✅ Panel registrado: ${data.panelId}`);
    io.emit("updatePanels", Array.from(panels.keys()));
  });

  // 📱 Cliente Android se conecta a la nube
  socket.on("connectDevice", (data) => {
    const info = {
      socketId: socket.id,
      deviceId: data?.deviceId || "unknown",
      nombre: data?.nombre || "Sin nombre",
      modelo: data?.modelo || "",
      versionApp: data?.versionApp || "",
      ultimaConexion: new Date().toISOString(),
    };
    clients.set(socket.id, info);
    console.log(`📲 Nuevo dispositivo: ${info.nombre} (${info.deviceId})`);
    io.emit("updateClients", Array.from(clients.values()));
  });

  // 🔁 Relay de mensajes entre Panel y App
  socket.on("relayMessage", (msg) => {
    console.log("📨 Relay:", msg);
    io.emit("remoteMessage", msg);
  });

  // Desconexión
  socket.on("disconnect", () => {
    if (clients.has(socket.id)) {
      const info = clients.get(socket.id);
      console.log(`❌ Cliente desconectado: ${info.deviceId}`);
      clients.delete(socket.id);
    }
    for (const [id, p] of panels.entries()) {
      if (p.socketId === socket.id) {
        console.log(`⚠️ Panel desconectado: ${id}`);
        panels.delete(id);
      }
    }
    io.emit("updateClients", Array.from(clients.values()));
    io.emit("updatePanels", Array.from(panels.keys()));
  });
});

// ============================
// API REST - Estado
// ============================
app.get("/", (req, res) => {
  res.send("🌐 Render Backend activo ✅");
});

// Ping desde paneles locales
app.post("/api/ping", (req, res) => {
  const { id, source, devices, status, timestamp } = req.body || {};
  if (id) {
    panels.set(id, { lastPing: timestamp, devices, status });
    console.log(`☁️ Ping recibido de ${id}: ${devices} dispositivos`);
  }
  res.json({ ok: true });
});

// Ver estado de paneles y clientes
app.get("/status", (req, res) => {
  res.json({
    panels: Object.fromEntries(panels),
    clients: Array.from(clients.values()),
  });
});

// ============================
// INICIO DEL SERVIDOR
// ============================
server.listen(PORT, () => {
  console.log(`🚀 Render Backend escuchando en puerto ${PORT}`);
});
