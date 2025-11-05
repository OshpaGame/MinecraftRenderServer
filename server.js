// server.js — Panel Maestro con asignación por licencia
const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const socketIo = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));
const server = http.createServer(app);

const io = socketIo(server, { cors: { origin: "*" }, allowEIO3: true });

// === Archivos de datos ===
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const serversPath = path.join(dataDir, "servers.json");
const licensesPath = path.join(dataDir, "licenses.json");

if (!fs.existsSync(serversPath)) fs.writeFileSync(serversPath, "[]");
if (!fs.existsSync(licensesPath)) fs.writeFileSync(licensesPath, "[]");

let androidClients = new Map();

// === Cargar datos ===
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const saveJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// === Socket.IO ===
io.on("connection", (socket) => {
  console.log("📡 Cliente conectado:", socket.id);

  socket.on("connectDevice", (data) => {
    if (!data || !data.licencia) return;
    androidClients.set(socket.id, {
      socketId: socket.id,
      licencia: data.licencia,
      nombre: data.nombre || "Desconocido",
      modelo: data.modelo || "—",
      versionApp: data.versionApp || "—",
      estado: "online",
    });
    console.log(`📱 Android conectado: ${data.nombre} (${data.licencia})`);
    io.emit("updateClientes", Array.from(androidClients.values()));
  });

  socket.on("disconnect", () => {
    androidClients.delete(socket.id);
    io.emit("updateClientes", Array.from(androidClients.values()));
  });
});

// === API de servidores ===

// 📋 Listar servidores
app.get("/api/servers", (_, res) => res.json(readJson(serversPath)));

// ➕ Agregar servidor
app.post("/api/servers", (req, res) => {
  const { name, url } = req.body;
  if (!name || !url)
    return res.status(400).json({ error: "Faltan campos: name y url" });

  const servers = readJson(serversPath);
  const nuevo = { id: Date.now(), name, url };
  servers.push(nuevo);
  saveJson(serversPath, servers);

  console.log(`📦 Nuevo servidor registrado: ${name}`);
  res.json({ success: true, servidor: nuevo });
});

// 🧩 Asignar servidor a una licencia
app.post("/api/assign", (req, res) => {
  const { license, serverId } = req.body;
  if (!license || !serverId)
    return res.status(400).json({ error: "Faltan datos" });

  const servers = readJson(serversPath);
  const licenses = readJson(licensesPath);
  const srv = servers.find((s) => s.id === serverId);
  if (!srv) return res.status(404).json({ error: "Servidor no encontrado" });

  let lic = licenses.find((l) => l.license === license);
  if (!lic) {
    lic = { license, assignedServer: srv };
    licenses.push(lic);
  } else {
    lic.assignedServer = srv;
  }

  saveJson(licensesPath, licenses);

  console.log(`🔗 Servidor '${srv.name}' asignado a licencia ${license}`);

  // Si el dispositivo con esa licencia está conectado, se lo enviamos
  for (const [_, c] of androidClients) {
    if (c.licencia === license) {
      io.to(c.socketId).emit("enviarServidor", {
        url: srv.url,
        nombre: srv.name,
      });
      console.log(`📤 Enviado servidor '${srv.name}' al Android ${license}`);
    }
  }

  res.json({ success: true, license, servidor: srv });
});

// 🧠 Obtener servidor asignado por licencia (para Android)
app.get("/api/assigned/:license", (req, res) => {
  const license = req.params.license;
  const licenses = readJson(licensesPath);
  const entry = licenses.find((l) => l.license === license);
  if (!entry) return res.json({ assigned: null });
  res.json({ assigned: entry.assignedServer });
});

// 🚀
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("======================================");
  console.log(`☁️ Servidor Maestro en puerto ${PORT}`);
  console.log("✅ Sistema de asignación por licencia activo.");
  console.log("======================================");
});

