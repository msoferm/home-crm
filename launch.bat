@echo off
chcp 65001 > nul
title כלכלת הבית - שרת מקומי
cd /d "%~dp0"

echo.
echo  ====================================================
echo   כלכלת הבית - מערכת ניהול אישית
echo  ====================================================
echo.
echo   מפעיל שרת מקומי על http://localhost:8765
echo   נפתח אוטומטית בדפדפן ברירת המחדל...
echo.
echo   לסגירה: סגור חלון זה
echo  ====================================================
echo.

REM Open browser in 2 seconds (so server has time to start)
start "" /b cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:8765/"

REM Run the Node server (inline, no external file needed)
node -e "const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');const port=8765;const mime={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};http.createServer((req,res)=>{let p=decodeURIComponent(url.parse(req.url).pathname);if(p==='/')p='/index.html';const f=path.join(process.cwd(),p);fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found: '+p);}res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(d);});}).listen(port,()=>console.log('Server ready on http://localhost:'+port));"

pause
