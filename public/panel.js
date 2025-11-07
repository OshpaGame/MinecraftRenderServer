const socket = io();
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const moduleContainer = document.getElementById("moduleContainer");

// 🌐 Conexión socket
socket.on("connect", () => {
  statusDot.style.background = "#0f0";
  statusText.textContent = "Conectado al Render Cloud";
});

socket.on("disconnect", () => {
  statusDot.style.background = "#f00";
  statusText.textContent = "Desconectado";
});

// 📡 Recibir lista de dispositivos
socket.on("updateClientes", (list) => {
  const device = list[0];
  if (device) {
    document.getElementById("deviceName").textContent = device.nombre;
    document.getElementById("deviceIP").textContent = device.ip;
    document.getElementById("deviceLicense").textContent = device.licencia;
  }
});

// 🔄 Cargar módulo
function openModule(name) {
  if (name === "gestor") {
    fetch("gestor.html")
      .then((res) => res.text())
      .then((html) => {
        moduleContainer.innerHTML = html;
        moduleContainer.classList.remove("hidden");
        window.scrollTo(0, document.body.scrollHeight);
      });
  } else {
    alert("🔧 Módulo en desarrollo: " + name);
  }
}
