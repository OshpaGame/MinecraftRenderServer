@echo off
setlocal EnableDelayedExpansion
title ☁️ Minecraft Render Server - Auto Sync + Deploy
color 0A
chcp 65001 >nul

echo ============================================
echo     ☁️ Minecraft Render Server - Deploy Tool
echo ============================================
echo.

cd /d "%~dp0"

echo 🌐 Verificando conexión...
ping -n 1 github.com >nul 2>&1
if errorlevel 1 (
    echo ❌ No hay conexión. Verifica tu red.
    pause
    exit /b
)
echo ✅ Conexión establecida.
echo.

set "BACKUP_DIR=%~dp0backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f "delims=" %%A in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "DATESTR=%%A"
set "BACKUP_FILE=%BACKUP_DIR%\mc_render_backup_!DATESTR!.zip"
echo 💾 Creando respaldo...
powershell -NoProfile -Command ^
 "Compress-Archive -Path * -DestinationPath '%BACKUP_FILE%' -Force -CompressionLevel Optimal" >nul 2>&1
if exist "%BACKUP_FILE%" (echo ✅ Respaldo creado.) else (echo ⚠️ No se pudo crear respaldo.)
echo.

if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\rebase-merge" (
    git rebase --abort >nul 2>&1
    rmdir /s /q ".git\rebase-merge" >nul 2>&1
)
echo 🧹 Limpieza Git completada.
echo.

for /f "tokens=*" %%b in ('git branch --show-current') do set "BRANCH=%%b"
if "%BRANCH%"=="" set "BRANCH=main"
echo 🧭 Rama actual: %BRANCH%
echo.

(
echo node_modules/
echo backups/
echo *.log
echo .env
)>".gitignore"

git add -A >nul 2>&1
git restore --staged node_modules >nul 2>&1
git diff --cached --quiet
if errorlevel 1 (
    set "MSG=📦 Deploy MinecraftRenderServer (%DATE% %TIME%)"
    git commit -m "!MSG!" >nul 2>&1
    echo ✅ Commit creado: "!MSG!"
) else (
    echo ⚙️ No hay cambios nuevos.
)
echo.

git fetch origin %BRANCH% >nul 2>&1
git pull --rebase origin %BRANCH%
if errorlevel 1 (
    echo ⚠️ Conflicto detectado. Abriendo VSCode...
    code .
    pause
    exit /b
)
echo ✅ Rebase limpio completado.
echo.

git push origin %BRANCH%
if errorlevel 1 (
    echo ❌ Error al subir cambios. Verifica credenciales.
    pause
    exit /b
)
echo ✅ Cambios subidos correctamente a GitHub.
echo.

echo 🧹 Limpiando respaldos antiguos...
for /f "skip=5 delims=" %%F in ('dir "%BACKUP_DIR%\mc_render_backup_*.zip" /b /o-d') do del /q "%BACKUP_DIR%\%%F" >nul 2>&1
echo ✅ Limpieza completada.
echo.

if exist "render.yaml" (
    echo 🧰 Archivo render.yaml detectado — Render redeployará automáticamente.
) else (
    echo ⚠️ No se encontró render.yaml — verifícalo en Render.
)
echo.

echo ============================================
echo 🎉 ¡Actualización completada con éxito!
echo 🌐 Render redeployará los cambios automáticamente.
echo ============================================
echo 🔗 Panel web: https://minecraft-render-server-4ps0.onrender.com
echo 📦 Repo GitHub: https://github.com/OshpaGame/MinecraftRenderServer
echo 💾 Backup: %BACKUP_FILE%
echo.
pause
exit /b
