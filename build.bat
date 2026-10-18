@echo off
rem Builds CircuitJS1 on Windows.
rem
rem   build.bat            compile GWT and assemble the web site in site\, then copy
rem                        it into the offline app's resources\app (if packaged)
rem                        and into the installed copy in %INSTALL% (if present)
rem   build.bat electron   ...package the offline app in offline\CircuitJS1-win32-x64
rem                        from scratch instead, then update the installed copy
rem   build.bat serve      serve site\ on http://localhost:8000 (needs Python)
rem
rem Uses the portable JDK 8 and Gradle home in .tools\ when present, otherwise
rem the JAVA_HOME already set (GWT 2.8 needs JDK 8).
setlocal EnableExtensions
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "TOOLS=%ROOT%\.tools"
set "ELECTRON_VERSION=v44.9.0"
set "ELECTRON_ZIP=%TOOLS%\dl\electron-%ELECTRON_VERSION%-win32-x64.zip"
set "OUT=%ROOT%\offline\CircuitJS1-win32-x64"
set "INSTALL=C:\Program Files\CircuitJS"

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=site"
if /i "%TARGET%"=="serve" goto serve
if /i "%TARGET%"=="site" goto java
if /i "%TARGET%"=="electron" goto java
echo Unknown target "%TARGET%". Use: build.bat [site^|electron^|serve]
exit /b 1

:java
for /d %%D in ("%TOOLS%\jdk8*") do set "JAVA_HOME=%%~fD"
if not defined JAVA_HOME (
    echo JDK 8 not found: put it in .tools\jdk8... or set JAVA_HOME.
    exit /b 1
)
if exist "%TOOLS%\gradle-home" set "GRADLE_USER_HOME=%TOOLS%\gradle-home"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo === JAVA_HOME=%JAVA_HOME%

cd /d "%ROOT%"
call "%ROOT%\gradlew.bat" compileGwt makeSite --console plain || goto fail
if /i "%TARGET%"=="electron" goto electron
echo === Done: site\circuitjs.html
if not exist "%OUT%\resources\app\war" exit /b 0

rem the offline app is already packaged: refresh only its resources\app (the site
rem and app\*, except package.json, which the packaging points at portable.js)
rem without extracting Electron again, then update the installed copy
echo === Updating %OUT%\resources\app
robocopy "%ROOT%\site" "%OUT%\resources\app\war" /e /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
robocopy "%ROOT%\app" "%OUT%\resources\app" /xf package.json *.cs /r:1 /w:1 /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
call :helper "%OUT%\resources\app" || goto fail
if exist "%INSTALL%\resources\app" call :install || goto fail
exit /b 0

:electron
if not exist "%ELECTRON_ZIP%" (
    echo Electron not found: %ELECTRON_ZIP%
    exit /b 1
)
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Select-String -Path 'src\com\lushprojects\circuitjs1\client\circuitjs1.java' -Pattern 'versionString = .([\w.]+)').Matches[0].Groups[1].Value"`) do set "VERSION=%%V"
echo === Packaging CircuitJS1 %VERSION% with Electron %ELECTRON_VERSION%

rem files of a running instance are locked, and clearing would stop halfway
powershell -NoProfile -Command "if (Get-Process CircuitJS1 -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:OUT + '\*') }) { exit 1 }"
if errorlevel 1 (
    echo CircuitJS1 is running from %OUT%: close it and run again.
    exit /b 1
)
rem clear the previous build but keep the portable profile (data\)
if not exist "%OUT%" mkdir "%OUT%"
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:OUT -Force | Where-Object Name -ne 'data' | Remove-Item -Recurse -Force -Confirm:$false" || goto fail
tar -xf "%ELECTRON_ZIP%" -C "%OUT%" || goto fail
del /q "%OUT%\resources\default_app.asar" 2>nul
ren "%OUT%\electron.exe" CircuitJS1.exe || goto fail

set "APP=%OUT%\resources\app"
mkdir "%APP%"
robocopy "%ROOT%\app" "%APP%" /xf *.cs /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail
call :helper "%APP%" || goto fail
robocopy "%ROOT%\site" "%APP%\war" /e /nfl /ndl /njh /njs /np >nul
if errorlevel 8 goto fail

rem own profile (data\ next to the exe) instead of %APPDATA%\Circuit JS1 used by the installed app
if exist "%TOOLS%\portable.js" (
    copy /y "%TOOLS%\portable.js" "%APP%" >nul
    powershell -NoProfile -Command "$p = Join-Path $env:APP 'package.json'; $q = [char]34; (Get-Content -Raw $p) -replace ('{0}main{0}:\s*{0}main\.js{0}' -f $q), ('{0}main{0}: {0}portable.js{0}' -f $q) | Set-Content -NoNewline -Encoding ASCII $p" || goto fail
)

rem zip without the portable profile
powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOLS%\zip-app.ps1" -Folder "%OUT%" -Zip "%ROOT%\offline\CircuitJS1-%VERSION%-win32-x64.zip" || goto fail
echo === Done: %OUT%\CircuitJS1.exe and offline\CircuitJS1-%VERSION%-win32-x64.zip
if exist "%INSTALL%\resources\app" call :install || goto fail
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

rem Copies resources\app over the installed one: files are added or replaced,
rem none removed (the installed copy has extra files).  Program Files is
rem writable only by administrators, so without rights it asks for UAC.
rem robocopy writes its summary (and any error) to a log, also when it runs
rem elevated in a hidden window, and the log is printed at the end.
:install
set "SRC=%OUT%\resources\app"
set "DST=%INSTALL%\resources\app"
set "LOG=%TEMP%\circuitjs-install.log"
set "RC=/e /r:1 /w:1 /nfl /ndl /njh /np /log:"%LOG%""
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
rem bit 1 of the robocopy code: some files were copied
set /a "COPIED=CODE & 1"
if %COPIED% equ 0 (
    echo === %DST% was already up to date.
) else (
    echo === Updated %DST%: restart CircuitJS if it is open.
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
