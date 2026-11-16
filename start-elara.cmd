@echo off
cd /d "%~dp0"
echo Opening ELARA local server...
echo Website: http://localhost:3000
echo Leads CRM: http://localhost:3000/CRM/112026 (password required)
node server.mjs
pause
