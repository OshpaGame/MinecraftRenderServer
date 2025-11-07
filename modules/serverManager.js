// modules/serverManager.js
// Gestor de servidores manual: CRUD basado en carpetas locales

const fs = require('fs');
const path = require('path');

module.exports = function initServerManager(app) {
  const dataDir = path.join(__dirname, '..', 'data');
  const serversDbPath = path.join(dataDir, 'servers.json');

  function readJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
  }
  function writeJSON(p, data) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }
  function load() { return readJSON(serversDbPath); }
  function save(arr) { writeJSON(serversDbPath, arr); }
  function byId(id) { return load().find(s => s.id === String(id)); }

  // Listar todos
  app.get('/servers', (req, res) => {
    res.json(load());
  });

  // Crear (manual)
  // body: { nombre, tipo, variante, version, ruta }
  app.post('/servers', (req, res) => {
    try {
      const { nombre, tipo, variante, version, ruta } = req.body || {};
      if (!nombre || !tipo || !variante || !version || !ruta) {
        return res.status(400).json({ ok:false, error:'Faltan campos: nombre, tipo, variante, version, ruta' });
      }
      const arr = load();
      if (arr.some(s => s.nombre.toLowerCase() === String(nombre).toLowerCase())) {
        return res.status(409).json({ ok:false, error:'Ya existe un servidor con ese nombre' });
      }
      // Validación suave de carpeta
      if (!fs.existsSync(ruta) || !fs.statSync(ruta).isDirectory()) {
        return res.status(400).json({ ok:false, error:'La ruta no existe o no es carpeta' });
      }
      const entry = {
        id: Date.now().toString(),
        nombre: String(nombre),
        tipo: String(tipo),
        variante: String(variante),
        version: String(version),
        ruta: path.normalize(ruta),
        fecha: new Date().toISOString()
      };
      arr.push(entry); save(arr);
      res.json({ ok:true, servidor: entry });
    } catch (e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // Actualizar
  // body: { nombre?, tipo?, variante?, version?, ruta? }
  app.put('/servers/:id', (req, res) => {
    try {
      const id = req.params.id;
      const arr = load();
      const idx = arr.findIndex(s => s.id === String(id));
      if (idx < 0) return res.status(404).json({ ok:false, error:'No existe' });

      const patch = req.body || {};
      if (patch.ruta) {
        if (!fs.existsSync(patch.ruta) || !fs.statSync(patch.ruta).isDirectory()) {
          return res.status(400).json({ ok:false, error:'La ruta no existe o no es carpeta' });
        }
      }
      arr[idx] = { ...arr[idx], ...patch };
      save(arr);
      res.json({ ok:true, servidor: arr[idx] });
    } catch (e) {
      res.status(500).json({ ok:false, error:e.message });
    }
  });

  // Eliminar (solo del registro; no borra archivos)
  app.delete('/servers/:id', (req, res) => {
    try {
      const id = req.params.id;
      const arr = load();
      const exists = arr.some(s => s.id === String(id));
      if (!exists) return res.status(404).json({ ok:false, error:'No existe' });
      const next = arr.filter(s => s.id !== String(id));
      save(next);
      res.json({ ok:true });
    } catch (e) {
      res.status(500).json({ ok:false, error:e.message });
    }
  });

  // Resolver ruta por id (ayuda para debug)
  app.get('/servers/resolve/:id', (req,res)=>{
    const s = byId(req.params.id);
    if (!s) return res.status(404).json({ ok:false, error:'No existe' });
    res.json({ ok:true, ruta: s.ruta });
  });
};
