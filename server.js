// server.js — Servidor Render Cloud (Minecraft Remote Panel)
const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// ============================
// 🔌 Configuración Socket.IO
// ============================
const io = socketIo(server, {
  cors: { origin: "*" },
  allowEIO3: true, // compatibilidad Android (socket.io-client 2.x)
});

// ============================
// 🗂 Estructuras en memoria
// ============================
let androidClients = new Map();
let panelesLocales = new Map();

// ============================
// ⚙️ Funciones auxiliares
// ============================
function broadcastClients() {
  const list = Array.from(androidClients.values());
  io.emit("updateClientes", list);
  console.log(`📡 Enviando lista a todos los clientes (${list.length} activos).`);
}

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace("::1", "localhost");
}

// ============================
// 📦 Configuración de almacenamiento (uploads)
// ============================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// ============================
// ⚙️ Eventos Socket.IO
// ============================
io.on("connection", (socket) => {
  const ip = socket.handshake.headers["x-forwarded-for"] || socket.conn.remoteAddress;
  const cleanIp = sanitizeIp(ip);
  console.log(`🌍 Nueva conexión: ${socket.id} (${cleanIp})`);

  // 📱 Registro cliente Android
  socket.on("connectDevice", (data) => {
    if (!data) return;
    const info = {
      socketId: socket.id,
      deviceId: data.deviceId || `unknown-${socket.id}`,
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      licencia: data.licencia || "—",
      ip: cleanIp,
      estado: "online",
      ultimaConexion: new Date().toISOString(),
    };
    androidClients.set(socket.id, info);
    console.log(`📲 Cliente conectado: ${info.nombre} (${info.deviceId})`);
    broadcastClients();
  });

  // 🧠 Registro de panel maestro local
  socket.on("registerPanel", (panelData) => {
    const data = {
      ...panelData,
      socketId: socket.id,
      ultimaSync: new Date().toISOString(),
    };
    panelesLocales.set(socket.id, data);
    console.log(`🧩 Panel local registrado: ${panelData.panelId || socket.id}`);
  });

  // 💾 Enviar servidor a un cliente Android específico
  socket.on("enviarServidor", (payload) => {
    const { targetId, url, nombre } = payload || {};
    if (!targetId || !url) return;
    const clientSocket = io.sockets.sockets.get(targetId);
    if (clientSocket) {
      clientSocket.emit("enviarServidor", { url, nombre });
      console.log(`📦 Servidor enviado a ${targetId}: ${nombre}`);
    } else {
      console.log(`⚠️ Cliente ${targetId} no encontrado`);
    }
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    if (androidClients.has(socket.id)) {
      const c = androidClients.get(socket.id);
      androidClients.delete(socket.id);
      console.log(`❌ Cliente Android desconectado: ${c.nombre}`);
      broadcastClients();
    }
    if (panelesLocales.has(socket.id)) {
      console.log(`⚠️ Panel local desconectado: ${socket.id}`);
      panelesLocales.delete(socket.id);
    }
  });
});

// ============================
// 🌍 Endpoints HTTP básicos
// ============================
app.get("/", (_, res) => res.send("🟢 Render Cloud activo y listo."));
app.get("/api/ping", (_, res) => res.json({ status: "ok", time: new Date() }));

app.get("/api/dispositivos", (_, res) =>
  res.json(Array.from(androidClients.values()))
);

app.get("/api/paneles", (_, res) =>
  res.json(Array.from(panelesLocales.values()))
);

// ============================
// 📤 Subida de servidores ZIP
// ============================
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No se subió ningún archivo." });

  const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  console.log(`📦 Servidor subido: ${req.file.originalname}`);

  res.json({
    success: true,
    url: fileUrl,
    filename: req.file.filename,
  });
});

// 🧠 Enviar un servidor subido a todos los dispositivos activos
app.post("/api/send-server", (req, res) => {
  const { url, nombre } = req.body;
  if (!url || !nombre)
    return res.status(400).json({ error: "Faltan parámetros." });

  io.emit("enviarServidor", { url, nombre });
  console.log(`📤 Broadcast de servidor: ${nombre}`);
  res.json({ success: true });
});

// ============================
// 📁 Servir archivos subidos
// ============================
app.use("/uploads", express.static(uploadDir));

// ============================
// 🚀 Inicialización del servidor
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️ Servidor Render escuchando en puerto ${PORT}`);
  console.log("✅ Listo para recibir Android Clients y Paneles Locales");
  console.log("======================================");
});


