@echo off
cd /d "%~dp0"
echo Opening ELARA local server...
echo Website: http://localhost:3000
echo Leads CRM: http://localhost:3000/crm
node server.mjs
pause
