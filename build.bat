@echo off
where node >nul 2>nul || (echo Install Node.js first: https://nodejs.org & pause & exit /b 1)
where cargo >nul 2>nul || (echo Install Rust first: https://rustup.rs & pause & exit /b 1)
call npm install || goto :err
call npm run tauri build || goto :err
start "" "src-tauri\target\release\bundle\nsis"
exit /b 0
:err
echo Build failed. Copy the error above and send it to Claude.
pause
