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
// 🗂️ Estructuras en memoria
// ============================
let androidClients = new Map(); // Dispositivos Android conectados
let panelesLocales = new Map(); // Paneles locales sincronizados

// ============================
// 🧩 Funciones auxiliares
// ============================
function broadcastClients() {
  const list = Array.from(androidClients.values());

  // 🔄 Enviar lista a todos (Render UI + Paneles locales)
  io.emit("updateClientes", list);

  console.log(`📡 Broadcast Render → ${list.length} dispositivo(s) activo(s).`);
}

function sanitizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace("::1", "localhost");
}

// ============================
// ⚙️ Eventos principales Socket.IO
// ============================
io.on("connection", (socket) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"] ||
    socket.conn.remoteAddress ||
    "unknown";
  const cleanIp = sanitizeIp(ip);

  console.log(`🌍 Nueva conexión: ${socket.id} (${cleanIp})`);

  // ======================
  // 📱 Registro de cliente Android
  // ======================
  socket.on("connectDevice", (data) => {
    if (!data) return;
    console.log("📱 Cliente Android conectado a Render:", data);

    const info = {
      socketId: socket.id,
      deviceId: data.deviceId || `unknown-${socket.id}`,
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      ip: cleanIp,
      estado: "online",
      ultimaConexion: new Date().toISOString(),
    };

    androidClients.set(socket.id, info);
    broadcastClients(); // 🔄 Enviar actualización a paneles locales
  });

  // ======================
  // 🧠 Registro de panel maestro local
  // ======================
  socket.on("registerPanel", (panelData) => {
    const data = {
      ...panelData,
      socketId: socket.id,
      ultimaSync: new Date().toISOString(),
    };
    panelesLocales.set(socket.id, data);
    console.log(`🧩 Panel local registrado: ${panelData.panelId || socket.id}`);
  });

  // ======================
  // 🔄 Sincronización periódica desde panel local
  // ======================
  socket.on("syncPanel", (data) => {
    if (!data) return;
    panelesLocales.set(socket.id, {
      ...data,
      ultimaSync: new Date().toISOString(),
    });
    console.log(
      `🔁 Sync recibida desde panel "${data.nombre}" (${data.dispositivos} dispositivos)`
    );

    // 🔄 Cuando un panel sincroniza, le enviamos los dispositivos activos
    socket.emit("updateClientes", Array.from(androidClients.values()));
  });

  // ======================
  // 💬 Broadcast global opcional
  // ======================
  socket.on("broadcastMessage", (msg) => {
    console.log(`💬 Broadcast recibido: ${msg}`);
    io.emit("remoteMessage", msg);
  });

  // ======================
  // ❌ Desconexión
  // ======================
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
app.get("/", (_, res) => res.send("🟢 Render Cloud activo y listo."));
app.get("/api/ping", (_, res) => res.json({ status: "ok", time: new Date() }));

app.get("/api/dispositivos", (_, res) => {
  res.json(Array.from(androidClients.values()));
});

app.get("/api/paneles", (_, res) => {
  res.json(Array.from(panelesLocales.values()));
});

// ============================
// 🔑 VALIDACIÓN DE LICENCIAS (API para Android)
// ============================
const licPath = path.join(__dirname, 'data', 'licensias.json');

/**
 * GET para debug opcional (no es necesario exponerlo público)
 * Ejemplo: https://minecraft-render-server-4ps0.onrender.com/api/licencias
 */
app.get('/api/licencias', (_, res) => {
  try {
    const list = JSON.parse(fs.readFileSync(licPath, 'utf8'));
    res.json({ count: list.length, sample: list.slice(0, 3) });
  } catch (err) {
    res.status(500).json({ error: 'Error al leer licencias', message: err.message });
  }
});

/**
 * POST /api/validate-key
 * Valida una licencia enviada desde el cliente Android
 * Body esperado: { "key": "ABC123..." }
 */
app.post('/api/validate-key', express.json(), (req, res) => {
  try {
    const key = req.body.key?.trim();
    if (!key) {
      return res.status(400).json({ valid: false, error: 'Falta la clave' });
    }

    if (!fs.existsSync(licPath)) {
      return res.status(500).json({ valid: false, error: 'Archivo de licencias no encontrado' });
    }

    const licencias = JSON.parse(fs.readFileSync(licPath, 'utf8'));
    const encontrada = licencias.find(l => l.key === key || l === key);

    if (encontrada) {
      console.log("🔑 Licencia válida usada: " + key);
      return res.json({ valid: true, key, status: 'ok' });
    } else {
      console.log(❌ Intento con clave inválida: ${key});
      return res.status(403).json({ valid: false, error: 'Clave no válida' });
    }
  } catch (err) {
    console.error('⚠ Error validando licencia:', err);
    return res.status(500).json({ valid: false, error: 'Error interno del servidor' });
  }
});

// ============================
// 🚀 Inicialización del servidor Render
// ============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️  Servidor Render escuchando en puerto ${PORT}`);
  console.log("✅  Listo para recibir Android Clients y Paneles Locales");
  console.log("======================================");
});



