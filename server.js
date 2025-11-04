// server.js - Servidor Maestro Render Cloud (Minecraft Remote Panel)
const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// ============================
// 🔌 Configuración del socket.io
// ============================
const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true, // compatibilidad Android (socket.io-client 2.x)
});

// ============================
// 🗂️ Estructuras de datos
// ============================
let androidClients = new Map(); // Clientes Android conectados
let panelesLocales = new Map(); // Paneles locales sincronizados

// ============================
// 🧩 Funciones auxiliares
// ============================
function broadcastClients() {
  const list = Array.from(androidClients.values());
  io.emit("updateClientes", list);
  console.log(`📡 Broadcast Render → ${list.length} dispositivos activos.`);
}

// ============================
// 📱 Android Clients
// ============================
io.on("connection", (socket) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.conn.remoteAddress?.replace(/^.*:/, "") ||
    "unknown";
  console.log(`🌍 Nueva conexión Socket: ${socket.id} (${ip})`);

  // === Registro de cliente Android ===
  socket.on("connectDevice", (data) => {
    if (!data) return;
    console.log("📱 Cliente Android conectado a Render:", data);

    const info = {
      socketId: socket.id,
      deviceId: data.deviceId || `unknown-${socket.id}`,
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      ip,
      estado: "online",
      ultimaConexion: new Date().toISOString(),
    };

    androidClients.set(socket.id, info);
    broadcastClients();
  });

  // === Registro de panel local ===
  socket.on("registerPanel", (panelData) => {
    panelesLocales.set(socket.id, {
      ...panelData,
      socketId: socket.id,
      ultimaSync: new Date().toISOString(),
    });
    console.log(`🧠 Panel local sincronizado: ${panelData.panelId || socket.id}`);
  });

  // === Sincronización periódica desde panel local ===
  socket.on("syncPanel", (data) => {
    if (!data) return;
    panelesLocales.set(socket.id, {
      ...data,
      ultimaSync: new Date().toISOString(),
    });
    console.log(`🔄 Sync recibida del panel: ${data.nombre} (${data.dispositivos} dispositivos)`);
  });

  // === Desconexión ===
  socket.on("disconnect", () => {
    if (androidClients.has(socket.id)) {
      const c = androidClients.get(socket.id);
      c.estado = "offline";
      androidClients.delete(socket.id);
      console.log(`❌ Cliente Android desconectado: ${c.nombre} (${c.deviceId})`);
      broadcastClients();
    }

    if (panelesLocales.has(socket.id)) {
      console.log(`⚠️ Panel local desconectado: ${socket.id}`);
      panelesLocales.delete(socket.id);
    }
  });
});

// ============================
// 🌍 Endpoints HTTP
// ============================
app.get("/", (_, res) => res.send("🟢 Servidor Render Cloud activo."));
app.get("/api/ping", (_, res) => res.json({ status: "ok" }));

app.get("/api/dispositivos", (_, res) => {
  res.json(Array.from(androidClients.values()));
});

app.get("/api/paneles", (_, res) => {
  res.json(Array.from(panelesLocales.values()));
});

// ============================
// 🚀 Inicializar servidor Render
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`☁️ Render Backend escuchando en puerto ${PORT}`);
  console.log("✅ Listo para recibir Android clients y paneles locales.");
});
