@echo off
setlocal EnableDelayedExpansion
title ☁️ Minecraft Render Server - Auto Sync + Deploy (SAFE MODE)
color 0A
chcp 65001 >nul

:: Si ocurre un error, pausamos en lugar de cerrar
set "ERROR_LOG=%~dp0deploy_error.log"
echo ============================================ > "%ERROR_LOG%"
echo [%date% %time%] Inicio de despliegue >> "%ERROR_LOG%"
echo ============================================ >> "%ERROR_LOG%"

cd /d "%~dp0"

echo 🌐 Verificando conexión...
ping -n 1 github.com >nul 2>&1
if errorlevel 1 (
    echo ❌ No hay conexión. >> "%ERROR_LOG%"
    echo ❌ No hay conexión. Verifica tu red.
    pause
    goto :END
)
echo ✅ Conexión establecida.

set "BACKUP_DIR=%~dp0backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f "delims=" %%A in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "DATESTR=%%A"
set "BACKUP_FILE=%BACKUP_DIR%\mc_render_backup_!DATESTR!.zip"
echo 💾 Creando respaldo...
powershell -NoProfile -Command ^
 "Compress-Archive -Path * -DestinationPath '%BACKUP_FILE%' -Force -CompressionLevel Optimal" >nul 2>&1
if exist "%BACKUP_FILE%" (
    echo ✅ Respaldo creado.
) else (
    echo ⚠️ No se pudo crear respaldo. >> "%ERROR_LOG%"
    echo ⚠️ No se pudo crear respaldo.
)
echo.

if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\rebase-merge" (
    git rebase --abort >nul 2>&1
    rmdir /s /q ".git\rebase-merge" >nul 2>&1
)
echo 🧹 Limpieza Git completada.

for /f "tokens=*" %%b in ('git branch --show-current 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" set "BRANCH=main"
echo 🧭 Rama actual: %BRANCH%

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

:: ===========================================
:: 🔒 Protección automática de archivos críticos
:: ===========================================
if exist "public\gestor.html" (
    echo 🔐 Guardando copia local de gestor.html...
    copy /Y "public\gestor.html" "%TEMP%\gestor_local_backup.html" >nul
)
if exist "server.js" (
    echo 🔐 Guardando copia local de server.js...
    copy /Y "server.js" "%TEMP%\server_local_backup.js" >nul
)

git fetch origin %BRANCH% >nul 2>&1
git pull --rebase origin %BRANCH% >nul 2>&1
if errorlevel 1 (
    echo ⚠️ Conflicto detectado. Abriendo VSCode...
    code .
    pause
    goto :END
)
echo ✅ Rebase limpio completado.

:: 🔄 Restaurar gestor.html si detecta la versión vieja
if exist "%TEMP%\gestor_local_backup.html" (
    find /I "URL del servidor" "public\gestor.html" >nul 2>&1
    set "FIND_ERR=%errorlevel%"
    if "%FIND_ERR%"=="0" (
        echo ⚠️ Versión vieja de gestor.html detectada — restaurando versión ZIP...
        copy /Y "%TEMP%\gestor_local_backup.html" "public\gestor.html" >nul
    ) else (
        echo 🧩 gestor.html actualizado.
    )
    del "%TEMP%\gestor_local_backup.html" >nul
)

:: 🔄 Restaurar server.js si no tiene Cache-Control
if exist "%TEMP%\server_local_backup.js" (
    find /I "Cache-Control" "server.js" >nul 2>&1
    set "CACHE_ERR=%errorlevel%"
    if "%CACHE_ERR%"=="1" (
        echo ⚠️ Versión vieja de server.js detectada — restaurando no-cache...
        copy /Y "%TEMP%\server_local_backup.js" "server.js" >nul
    ) else (
        echo 🧩 server.js actualizado.
    )
    del "%TEMP%\server_local_backup.js" >nul
)
echo.

git push origin %BRANCH% >nul 2>&1
if errorlevel 1 (
    echo ❌ Error al subir cambios. Verifica credenciales. >> "%ERROR_LOG%"
    echo ❌ Error al subir cambios. Verifica credenciales.
    pause
    goto :END
)
echo ✅ Cambios subidos correctamente a GitHub.

echo 🧹 Limpiando respaldos antiguos...
for /f "skip=5 delims=" %%F in ('dir "%BACKUP_DIR%\mc_render_backup_*.zip" /b /o-d 2^>nul') do del /q "%BACKUP_DIR%\%%F" >nul 2>&1
echo ✅ Limpieza completada.

if exist "render.yaml" (
    echo 🧰 render.yaml detectado — Render redeployará automáticamente.
) else (
    echo ⚠️ No se encontró render.yaml.
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
echo (Si la ventana se cerró sola, revisa %ERROR_LOG%)
pause
goto :END

:END
echo.
echo 💡 Script finalizado.
pause
exit /b
