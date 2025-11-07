// modules/sendServer.js
// Envío de servidores a dispositivos: genera ZIP, crea token temporal y envía URL por Socket.IO

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

module.exports = function initSendServer(app, io) {
  const dataDir = path.join(__dirname, '..', 'data');
  const enviosDir = path.join(dataDir, 'envios');
  const serversDbPath = path.join(dataDir, 'servers.json');
  const enviosDbPath = path.join(dataDir, 'envios.json');

  // Crear rutas si no existen
  if (!fs.existsSync(enviosDir)) fs.mkdirSync(enviosDir, { recursive: true });
  if (!fs.existsSync(enviosDbPath)) fs.writeFileSync(enviosDbPath, '[]');

  // === utilidades JSON ===
  function readJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
  }
  function writeJSON(p, data) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }

  function loadServers() { return readJSON(serversDbPath); }
  function loadEnvios() { return readJSON(enviosDbPath); }
  function saveEnvios(arr) { writeJSON(enviosDbPath, arr); }

  // === limpiar enlaces expirados ===
  function pruneExpired() {
    const now = Date.now();
    const arr = loadEnvios();
    const keep = [];
    for (const e of arr) {
      if (e.expiresAt && e.expiresAt < now) {
        try {
          if (e.file && fs.existsSync(e.file)) fs.unlinkSync(e.file);
        } catch {}
      } else {
        keep.push(e);
      }
    }
    saveEnvios(keep);
  }

  // === comprimir servidor seleccionado ===
  function zipServerFolder(serverEntry) {
    const safeName = serverEntry.nombre.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const outName = `server_${safeName}_${Date.now()}.zip`;
    const outPath = path.join(enviosDir, outName);

    const zip = new AdmZip();
    zip.addLocalFolder(serverEntry.ruta);
    zip.writeZip(outPath);

    const size = fs.statSync(outPath).size;
    return { outPath, outName, size };
  }

  // === buscar dispositivo conectado ===
  function getClientByDeviceId(deviceId) {
    const map = app.locals?.clientsMap;
    if (!map) return null;
    for (const [sid, c] of map.entries()) {
      if (c.deviceId === deviceId && c.estado === 'online') {
        return { socketId: sid, client: c };
      }
    }
    return null;
  }

  function getClientBySocketId(socketId) {
    const map = app.locals?.clientsMap;
    if (!map) return null;
    const c = map.get(socketId);
    return c ? { socketId, client: c } : null;
  }

  // === crear enlace temporal de descarga ===
  app.post('/send-server', async (req, res) => {
    try {
      pruneExpired();

      const { serverId, deviceId, socketId, ttlMinutes } = req.body || {};
      if (!serverId) return res.status(400).json({ ok: false, error: 'serverId requerido' });

      const servers = loadServers();
      const s = servers.find(x => x.id === String(serverId));
      if (!s) return res.status(404).json({ ok: false, error: 'Servidor no encontrado' });

      // buscar destino
      let target = null;
      if (socketId) target = getClientBySocketId(socketId);
      if (!target && deviceId) target = getClientByDeviceId(deviceId);
      if (!target) return res.status(404).json({ ok: false, error: 'Dispositivo no conectado' });

      // comprimir
      const { outPath, outName, size } = zipServerFolder(s);

      // token + expiración
      const token = crypto.randomBytes(16).toString('hex');
      const ttl = Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 6 * 60; // 6h por defecto
      const expiresAt = Date.now() + ttl * 60 * 1000;

      const arr = loadEnvios();
      arr.push({
        token,
        file: outPath,
        serverId: s.id,
        nombre: s.nombre,
        tipo: s.tipo,
        variante: s.variante,
        version: s.version,
        size,
        deviceId: target.client.deviceId,
        socketId: target.socketId,
        createdAt: Date.now(),
        expiresAt
      });
      saveEnvios(arr);

      const host = req.headers.host; // ej: "192.168.1.10:3000"
      const url = `http://${host}/download/${token}`;

      // notificar al Android por Socket.IO
      io.to(target.socketId).emit('enviarServidor', {
        nombre: s.nombre,
        tipo: s.tipo,
        variante: s.variante,
        version: s.version,
        size,
        url,
        token,
        expiresAt
      });

      res.json({
        ok: true,
        token,
        url,
        expiresAt,
        size,
        target: { deviceId: target.client.deviceId, socketId: target.socketId }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // === descarga del ZIP mediante token ===
  app.get('/download/:token', (req, res) => {
    try {
      pruneExpired();
      const { token } = req.params;
      const arr = loadEnvios();
      const entry = arr.find(e => e.token === token);
      if (!entry) return res.status(404).send('Enlace inválido');
      if (entry.expiresAt && entry.expiresAt < Date.now())
        return res.status(410).send('Enlace expirado');
      if (!entry.file || !fs.existsSync(entry.file))
        return res.status(404).send('Archivo no disponible');

      res.download(entry.file, path.basename(entry.file));
    } catch (e) {
      res.status(500).send('Error de descarga');
    }
  });

  // === limpiar envíos caducados manualmente ===
  app.post('/purge-downloads', (req, res) => {
    pruneExpired();
    res.json({ ok: true });
  });
};
