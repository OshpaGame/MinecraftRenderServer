// server.js - Servidor Maestro Render Cloud (Minecraft Remote Panel)
const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");

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
// 🗂 Estructuras en memoria
// ============================
let androidClients = new Map();
let panelesLocales = new Map();

// ============================
// 🧩 Funciones auxiliares
// ============================
function broadcastClients() {
  const list = Array.from(androidClients.values());
  io.emit("updateClientes", list);
  console.log(📡 Broadcast Render → ${list.length} dispositivo(s) activo(s).);
}

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace("::1", "localhost");
}

// ============================
// ⚙ Eventos principales Socket.IO
// ============================
io.on("connection", (socket) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.conn.remoteAddress ||
    "unknown";
  const cleanIp = sanitizeIp(ip);

  console.log(🌍 Nueva conexión: ${socket.id} (${cleanIp}));

  socket.on("connectDevice", (data) => {
    if (!data) return;
    console.log("📱 Cliente Android conectado a Render:", data);

    const info = {
      socketId: socket.id,
      deviceId: data.deviceId || unknown-${socket.id},
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      ip: cleanIp,
      estado: "online",
      ultimaConexion: new Date().toISOString(),
    };

    androidClients.set(socket.id, info);
    broadcastClients();
  });

  socket.on("registerPanel", (panelData) => {
    const data = {
      ...panelData,
      socketId: socket.id,
      ultimaSync: new Date().toISOString(),
    };
    panelesLocales.set(socket.id, data);
    console.log(🧩 Panel local registrado: ${panelData.panelId || socket.id});
  });

  socket.on("syncPanel", (data) => {
    if (!data) return;
    panelesLocales.set(socket.id, {
      ...data,
      ultimaSync: new Date().toISOString(),
    });
    console.log(
      🔁 Sync recibida desde panel "${data.nombre}" (${data.dispositivos} dispositivos)
    );
    socket.emit("updateClientes", Array.from(androidClients.values()));
  });

  socket.on("broadcastMessage", (msg) => {
    console.log(💬 Broadcast recibido: ${msg});
    io.emit("remoteMessage", msg);
  });

  socket.on("disconnect", () => {
    if (androidClients.has(socket.id)) {
      const c = androidClients.get(socket.id);
      c.estado = "offline";
      androidClients.delete(socket.id);
      console.log(❌ Cliente Android desconectado: ${c.nombre} (${c.deviceId}));
      broadcastClients();
    }

    if (panelesLocales.has(socket.id)) {
      console.log(⚠ Panel local desconectado: ${socket.id});
      panelesLocales.delete(socket.id);
    }
  });
});

// ============================
// 🌍 Endpoints HTTP básicos
// ============================
app.get("/", (_, res) => res.send("🟢 Render Cloud activo y listo."));
app.get("/api/ping", (_, res) => res.json({ status: "ok", time: new Date() }));

app.get("/api/dispositivos", (_, res) => {
  res.json(Array.from(androidClients.values()));
});

app.get("/api/paneles", (_, res) => {
  res.json(Array.from(panelesLocales.values()));
});

// ============================
// 🔑 VALIDACIÓN DE LICENCIAS
// ============================
const licPath = path.join(__dirname, "data", "licenses.json");
const licPrefixedPath = path.join(__dirname, "data", "licenses_prefixed.json");

// 🔍 Listar licencias para debug
app.get("/api/licencias", (_, res) => {
  try {
    const list = JSON.parse(fs.readFileSync(licPath, "utf8"));
    res.json({ total: list.length, sample: list.slice(0, 3) });
  } catch (err) {
    res.status(500).json({ error: "Error al leer licencias", message: err.message });
  }
});

// ✅ Validar una clave
app.post("/api/validate-key", (req, res) => {
  try {
    const key = req.body.key?.trim();
    const deviceId = req.body.deviceId || "unknown";
    const nombre = req.body.nombre || "Sin nombre";
    const modelo = req.body.modelo || "—";

    if (!key) {
      return res.status(400).json({ valid: false, error: "Falta la clave" });
    }

    if (!fs.existsSync(licPath)) {
      return res.status(500).json({ valid: false, error: "Archivo de licencias no encontrado" });
    }

    const licencias = JSON.parse(fs.readFileSync(licPath, "utf8"));
    const licencia = licencias.find((l) => l.key === key || l === key);

    if (!licencia) {
      console.log(❌ Intento con clave inválida: ${key});
      return res.status(403).json({ valid: false, error: "Clave no válida" });
    }

    if (licencia.usada && licencia.deviceId && licencia.deviceId !== deviceId) {
      console.log(⚠ Clave ${key} ya está en uso por otro dispositivo (${licencia.deviceId}).);
      return res.status(409).json({
        valid: false,
        error: "Esta licencia ya está activada en otro dispositivo.",
      });
    }

    licencia.usada = true;
    licencia.deviceId = deviceId;
    licencia.nombre = nombre;
    licencia.modelo = modelo;
    licencia.fechaUso = new Date().toISOString();

    fs.writeFileSync(licPath, JSON.stringify(licencias, null, 2));
    console.log(🔑 Licencia válida usada: ${key} por ${nombre} (${deviceId}));

    return res.json({
      valid: true,
      key,
      status: "ok",
      message: "Licencia válida",
      deviceId,
    });
  } catch (err) {
    console.error("⚠ Error validando licencia:", err);
    return res.status(500).json({ valid: false, error: "Error interno del servidor" });
  }
});

// ============================
// 🎟 Entregar una licencia libre automáticamente
// ============================
app.get("/api/get-license", (req, res) => {
  try {
    if (!fs.existsSync(licPrefixedPath)) {
      return res.status(500).json({ error: "Archivo de licencias no encontrado" });
    }

    const licencias = JSON.parse(fs.readFileSync(licPrefixedPath, "utf8"));
    const libre = licencias.find((l) => !l.usada);

    if (!libre) {
      return res.status(404).json({ error: "No hay licencias disponibles" });
    }

    libre.usada = true;
    fs.writeFileSync(licPrefixedPath, JSON.stringify(licencias, null, 2));

    console.log(🎫 Licencia entregada: ${libre.key});
    res.json({ key: libre.key, status: "ok" });
  } catch (err) {
    console.error("⚠ Error en /api/get-license:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ============================
// 🚀 Inicialización del servidor Render
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(☁  Servidor Render escuchando en puerto ${PORT});
  console.log("✅  Listo para recibir Android Clients y Paneles Locales");
  console.log("======================================");
});
