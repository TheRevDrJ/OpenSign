@echo off
:: Double-click convenience for a display machine: stop the PRODUCTION server.
:: (To stop a dev server instead, run:  opensign.bat stop dev)
"%~dp0opensign.bat" stop prod
pause
