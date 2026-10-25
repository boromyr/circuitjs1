@echo off
rem Builds the TypeScript version of CircuitJS on Windows.
rem
rem   build.bat            build ts\ (npm, Vite) into site\, then refresh the offline
rem                        app's resources\app if it is packaged already
rem   build.bat electron   ...package the offline app in %OUT% from scratch instead
rem   build.bat install    build as above (packaging the app first if it is not packaged
rem                        yet), then copy it to %INSTALL% (asks for UAC if needed)
rem   build.bat serve      serve site\ on http://localhost:8000 (needs Python)
rem
rem The app goes to its own folders, next to the Java one (offline\CircuitJS-win32-x64,
rem C:\Program Files\CircuitJS), and keeps its own profile in data\ next to the exe.
setlocal EnableExtensions
rem ANSI colors for the messages (the console understands them on Windows 10 and later)
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "C_INFO=%ESC%[36m"
set "C_OK=%ESC%[32m"
set "C_WARN=%ESC%[33m"
set "C_ERR=%ESC%[31m"
set "C_OFF=%ESC%[0m"
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
set "DOINSTALL="
if /i "%TARGET%"=="install" (
    set "DOINSTALL=1"
    set "TARGET=site"
    if not exist "%OUT%\CircuitJS.exe" set "TARGET=electron"
)
if /i "%TARGET%"=="site" goto ts
if /i "%TARGET%"=="electron" goto ts
echo %C_ERR%Unknown target "%TARGET%". Use: build.bat [site^|electron^|install^|serve]%C_OFF%
exit /b 1

:ts
where npm >nul 2>&1 || (
    echo %C_ERR%npm not found: install Node.js.%C_OFF%
    exit /b 1
)
cd /d "%ROOT%\ts"
if not exist "node_modules" (
    echo %C_INFO%=== Installing the npm packages%C_OFF%
    call npm ci --no-audit --no-fund || goto fail
)
echo %C_INFO%=== Building the TypeScript app%C_OFF%
call npm run build || goto fail
cd /d "%ROOT%"
rem the bundle has a new hashed name at every build: mirror, so old ones go
robocopy "%ROOT%\ts\dist" "%ROOT%\site" /mir /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
if /i "%TARGET%"=="electron" goto electron
echo %C_OK%=== Done: site\circuitjs.html%C_OFF%
if not exist "%OUT%\resources\app\war" goto finish

rem the offline app is already packaged: refresh only its resources\app (the site and
rem app\*, except package.json, which the packaging points at portable.js)
echo %C_INFO%=== Updating %OUT%\resources\app%C_OFF%
robocopy "%ROOT%\site" "%OUT%\resources\app\war" /mir /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
robocopy "%ROOT%\app" "%OUT%\resources\app" /xf package.json *.cs /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
call :helper "%OUT%\resources\app" || goto fail
echo %C_OK%=== Done: %OUT%\CircuitJS.exe%C_OFF%
goto finish

:electron
if not exist "%ELECTRON_ZIP%" (
    echo %C_ERR%Electron not found: %ELECTRON_ZIP%%C_OFF%
    exit /b 1
)
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Select-String -Path 'ts\CirSim.ts' -Pattern 'versionString: string = .([\w.]+)').Matches[0].Groups[1].Value"`) do set "VERSION=%%V"
echo %C_INFO%=== Packaging CircuitJS %VERSION% with Electron %ELECTRON_VERSION%%C_OFF%

rem files of a running instance are locked, and clearing would stop halfway
powershell -NoProfile -Command "if (Get-Process CircuitJS -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:OUT + '\*') }) { exit 1 }"
if errorlevel 1 (
    echo %C_ERR%CircuitJS is running from %OUT%: close it and run again.%C_OFF%
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
echo %C_OK%=== Done: %OUT%\CircuitJS.exe%C_OFF%
goto finish

rem Compiles app\filedialog.cs (native open/save dialogs that remember the folder
rem even when closed without a file, see main.js) into the given app folder, with
rem the C# compiler of .NET Framework 4 that comes with Windows.  Without it the
rem app falls back to Electron's dialogs.
:helper
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo %C_WARN%C# compiler not found: the app will use Electron's file dialogs.%C_OFF%
    exit /b 0
)
"%CSC%" -nologo -target:winexe -optimize -out:"%~1\filedialog.exe" "%ROOT%\app\filedialog.cs" || exit /b 1
exit /b 0

rem Last step of every build.  With "install" it copies the packaged app (without its
rem profile, data\) to %INSTALL%: files are added or replaced, none removed.  Program
rem Files is writable only by administrators, so without rights it asks for UAC.
rem robocopy writes to a log (also when it runs elevated in a hidden window): the log
rem is printed only if the copy fails.
:finish
if not defined DOINSTALL exit /b 0
set "SRC=%OUT%"
set "DST=%INSTALL%"
set "LOG=%TEMP%\circuitjs-ts-install.log"
set "RC=/e /xd data /r:1 /w:1 /nfl /ndl /njh /np /log:"%LOG%""
echo %C_INFO%=== Copying to %DST%%C_OFF%
robocopy "%SRC%" "%DST%" %RC% >nul 2>&1
set "CODE=%errorlevel%"
if %CODE% lss 8 goto installed
echo %C_WARN%No write access to %INSTALL%: asking for administrator rights...%C_OFF%
powershell -NoProfile -Command "$q = [char]34; $a = '{0}{1}{0} {0}{2}{0} {3}' -f $q, $env:SRC, $env:DST, $env:RC; try { $p = Start-Process robocopy -ArgumentList $a -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop; exit $p.ExitCode } catch { exit 99 }"
set "CODE=%errorlevel%"
if %CODE% equ 99 (
    echo %C_ERR%Could not update %INSTALL%: administrator rights were declined.%C_OFF%
    exit /b 1
)
:installed
if %CODE% geq 8 (
    rem the log is in the ANSI code page: PowerShell converts it for the console
    if exist "%LOG%" powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG | Where-Object { $_.Trim() -and $_ -notmatch '^-+$|/sec|/min' } | ForEach-Object { [char]27 + '[31m' + $_ + [char]27 + '[0m' }"
    echo %C_ERR%=== Copy failed ^(robocopy code %CODE%^)%C_OFF%
    exit /b 1
)
set /a "COPIED=CODE & 1"
if %COPIED% equ 0 (
    echo %C_OK%=== %DST% was already up to date.%C_OFF%
) else (
    echo %C_OK%=== Copy completed successfully: restart CircuitJS TS if it is open.%C_OFF%
)
exit /b 0

:serve
if not exist "%ROOT%\site\circuitjs.html" (
    echo %C_ERR%site\ not built yet: run build.bat first.%C_OFF%
    exit /b 1
)
start "" http://localhost:8000/circuitjs.html
python -m http.server 8000 --bind 127.0.0.1 --directory "%ROOT%\site"
exit /b %errorlevel%

:fail
echo %C_ERR%=== Build failed%C_OFF%
exit /b 1
