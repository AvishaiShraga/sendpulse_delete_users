@echo off
echo מתקין תלויות ומפעיל את הפרויקט...

cd /d "%~dp0backend"
if not exist node_modules (
    echo מתקין backend...
    call npm install
)
start "Backend" cmd /k "npm start"

cd /d "%~dp0frontend"
if not exist node_modules (
    echo מתקין frontend...
    call npm install
)
start "Frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5173
