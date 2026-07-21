@echo off
echo Adding firewall rule for port 3000...
netsh advfirewall firewall add rule name=AllowPort3000 dir=in action=allow protocol=TCP localport=3000
if %errorlevel% equ 0 (
    echo Firewall rule added successfully!
) else (
    echo Failed to add firewall rule.
    echo Please run this file as Administrator manually.
)
pause