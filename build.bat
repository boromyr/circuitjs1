@echo off
rem Builds CircuitJS1 on Windows.
rem
rem   build.bat            compile GWT and assemble the web site in site\
rem   build.bat electron   ...then package the offline app in offline\CircuitJS1-win32-x64
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
copy /y "%ROOT%\app\*" "%APP%" >nul || goto fail
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
