@echo off
rem Builds the TypeScript version of CircuitJS on Windows.
rem
rem   build.bat            build ts\ (npm, Vite) into site\, then refresh the offline
rem                        app's resources\app if it is packaged already
rem   build.bat electron   ...package the offline app in %OUT% from scratch instead
rem   build.bat install    copy the packaged app to %INSTALL% (asks for UAC if needed)
rem   build.bat serve      serve site\ on http://localhost:8000 (needs Python)
rem
rem The app goes to its own folders, next to the Java one (offline\CircuitJS-win32-x64,
rem C:\Program Files\CircuitJS), and keeps its own profile in data\ next to the exe.
setlocal EnableExtensions
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
rem TOOLS (Electron zip, portable.js) can be given from outside, e.g. for a git worktree
if not defined TOOLS set "TOOLS=%ROOT%\.tools"
set "ELECTRON_VERSION=v45.0.0"
set "ELECTRON_ZIP=%TOOLS%\dl\electron-%ELECTRON_VERSION%-win32-x64.zip"
set "OUT=%ROOT%\offline\CircuitJS-ts-win32-x64"
set "INSTALL=C:\Program Files\CircuitJS"

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=site"
if /i "%TARGET%"=="serve" goto serve
if /i "%TARGET%"=="install" goto installonly
if /i "%TARGET%"=="site" goto ts
if /i "%TARGET%"=="electron" goto ts
echo Unknown target "%TARGET%". Use: build.bat [site^|electron^|install^|serve]
exit /b 1

:ts
where npm >nul 2>&1 || (
    echo npm not found: install Node.js.
    exit /b 1
)
cd /d "%ROOT%\ts"
if not exist "node_modules" (
    echo === Installing the npm packages
    call npm ci --no-audit --no-fund || goto fail
)
echo === Building the TypeScript app
call npm run build || goto fail
cd /d "%ROOT%"
rem the bundle has a new hashed name at every build: mirror, so old ones go
robocopy "%ROOT%\ts\dist" "%ROOT%\site" /mir /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
if /i "%TARGET%"=="electron" goto electron
echo === Done: site\circuitjs.html
if not exist "%OUT%\resources\app\war" exit /b 0

rem the offline app is already packaged: refresh only its resources\app (the site and
rem app\*, except package.json, which the packaging points at portable.js)
echo === Updating %OUT%\resources\app
robocopy "%ROOT%\site" "%OUT%\resources\app\war" /mir /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
robocopy "%ROOT%\app" "%OUT%\resources\app" /xf package.json *.cs /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
call :helper "%OUT%\resources\app" || goto fail
echo === Done: %OUT%\CircuitJS.exe
exit /b 0

:electron
if not exist "%ELECTRON_ZIP%" (
    echo Electron not found: %ELECTRON_ZIP%
    exit /b 1
)
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Select-String -Path 'ts\CirSim.ts' -Pattern 'versionString: string = .([\w.]+)').Matches[0].Groups[1].Value"`) do set "VERSION=%%V"
echo === Packaging CircuitJS %VERSION% with Electron %ELECTRON_VERSION%

rem files of a running instance are locked, and clearing would stop halfway
powershell -NoProfile -Command "if (Get-Process CircuitJS -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:OUT + '\*') }) { exit 1 }"
if errorlevel 1 (
    echo CircuitJS is running from %OUT%: close it and run again.
    exit /b 1
)
rem clear the previous build but keep the portable profile (data\)
if not exist "%OUT%" mkdir "%OUT%"
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:OUT -Force | Where-Object Name -ne 'data' | Remove-Item -Recurse -Force -Confirm:$false" || goto fail
tar -xf "%ELECTRON_ZIP%" -C "%OUT%" || goto fail
del /q "%OUT%\resources\default_app.asar" 2>nul
ren "%OUT%\electron.exe" CircuitJS.exe || goto fail
rem electron.exe carries the Electron icon: give the exe the CircuitJS one
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ts\scripts\set-exe-icon.ps1" -Exe "%OUT%\CircuitJS.exe" -Icon "%ROOT%\app\CircuitJS1.ico" || goto fail

set "APP=%OUT%\resources\app"
mkdir "%APP%"
robocopy "%ROOT%\app" "%APP%" /xf *.cs /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
call :helper "%APP%" || goto fail
robocopy "%ROOT%\site" "%APP%\war" /e /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail

rem own profile (data\ next to the exe) instead of %APPDATA%\Circuit JS1
if exist "%TOOLS%\portable.js" (
    copy /y "%TOOLS%\portable.js" "%APP%" >nul
    powershell -NoProfile -Command "$p = Join-Path $env:APP 'package.json'; $q = [char]34; (Get-Content -Raw $p) -replace ('{0}main{0}:\s*{0}main\.js{0}' -f $q), ('{0}main{0}: {0}portable.js{0}' -f $q) | Set-Content -NoNewline -Encoding ASCII $p" || goto fail
)

rem zip without the portable profile
if exist "%TOOLS%\zip-app.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\zip-app.ps1" -Folder "%OUT%" -Zip "%ROOT%\offline\CircuitJS-%VERSION%-win32-x64.zip" || goto fail
echo === Done: %OUT%\CircuitJS.exe
exit /b 0

rem Compiles app\filedialog.cs (native open/save dialogs that remember the folder
rem even when closed without a file, see main.js) into the given app folder, with
rem the C# compiler of .NET Framework 4 that comes with Windows.  Without it the
rem app falls back to Electron's dialogs.
:helper
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo C# compiler not found: the app will use Electron's file dialogs.
    exit /b 0
)
"%CSC%" -nologo -target:winexe -optimize -out:"%~1\filedialog.exe" "%ROOT%\app\filedialog.cs" || exit /b 1
exit /b 0

rem Copies the packaged app (without its profile, data\) to %INSTALL%: files are added
rem or replaced, none removed.  Program Files is writable only by administrators, so
rem without rights it asks for UAC.  robocopy writes its summary (and any error) to a
rem log, also when it runs elevated in a hidden window, and the log is printed at the end.
:installonly
if not exist "%OUT%\CircuitJS.exe" (
    echo The app is not packaged yet: run build.bat electron first.
    exit /b 1
)
set "SRC=%OUT%"
set "DST=%INSTALL%"
set "LOG=%TEMP%\circuitjs-ts-install.log"
set "RC=/e /xd data /r:1 /w:1 /nfl /ndl /njh /np /log:"%LOG%""
echo === Copying to %DST%
robocopy "%SRC%" "%DST%" %RC% >nul 2>&1
set "CODE=%errorlevel%"
if %CODE% lss 8 goto installed
echo No write access to %INSTALL%: asking for administrator rights...
powershell -NoProfile -Command "$q = [char]34; $a = '{0}{1}{0} {0}{2}{0} {3}' -f $q, $env:SRC, $env:DST, $env:RC; try { $p = Start-Process robocopy -ArgumentList $a -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop; exit $p.ExitCode } catch { exit 99 }"
set "CODE=%errorlevel%"
if %CODE% equ 99 (
    echo Could not update %INSTALL%: administrator rights were declined.
    exit /b 1
)
:installed
rem the log is in the ANSI code page: PowerShell converts it for the console
if exist "%LOG%" powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG | Where-Object { $_.Trim() -and $_ -notmatch '^-+$|/sec|/min' }"
if %CODE% geq 8 (
    echo === Copy failed ^(robocopy code %CODE%^): see the errors above.
    exit /b 1
)
set /a "COPIED=CODE & 1"
if %COPIED% equ 0 (
    echo === %DST% was already up to date.
) else (
    echo === Updated %DST%: restart CircuitJS TS if it is open.
)
exit /b 0

:serve
if not exist "%ROOT%\site\circuitjs.html" (
    echo site\ not built yet: run build.bat first.
    exit /b 1
)
start "" http://localhost:8000/circuitjs.html
python -m http.server 8000 --bind 127.0.0.1 --directory "%ROOT%\site"
exit /b %errorlevel%

:fail
echo === Build failed
exit /b 1
