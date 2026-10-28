# Notchy

Notch overlay for Windows (Tauri v2 + React + Rust).

## Prerequisites (Windows, PowerShell)
    winget install Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    winget install OpenJS.NodeJS.LTS
Restart PowerShell afterwards. WebView2 is already included in Windows 10/11.

## Run in dev mode
    npm install
    npm run tauri dev

## Build the .exe
    npm run tauri build

Outputs:
- src-tauri\target\release\notchy.exe            (portable exe)
- src-tauri\target\release\bundle\nsis\*.exe     (installer)

## One-click options
- Windows: double-click build.bat (needs Node.js + Rust + C++ Build Tools once).
- No setup: push this folder to GitHub, open Actions > "Build Windows exe" > Run workflow,
  then download the "notchy-windows" artifact (contains the .exe).
