@echo off
title Harvest Festival Volunteer Server
cd /d "C:\Users\johng\Documents\egr-harvest-festival\volunteer-portal"
echo Starting Harvest Festival Volunteer Server...
echo Site will be available at http://localhost:3000
echo.
echo DO NOT CLOSE THIS WINDOW - the server will stop if you do.
echo Minimize it instead.
echo.
npm run dev
pause
