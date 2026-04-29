Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "C:\Users\johng\Documents\egr-harvest-festival\volunteer-portal\start-server.bat" & chr(34), 7, False

' Wait 6 seconds for Next.js to finish booting, then open the browser
WScript.Sleep 6000
WshShell.Run "http://localhost:3000", 1, False
