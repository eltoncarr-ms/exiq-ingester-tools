@echo off
REM ============================================================================
REM build-tools.cmd
REM
REM Builds (publishes) all console tools under the "tools" directory and
REM collects their binaries/outputs (exes, dlls, configs, etc.) into a single
REM flat "binaries" folder.
REM
REM Because the output folder is flat, each tool ships a file with the same name
REM (notably appsettings.json) that would otherwise overwrite the others
REM (last-publish-wins, non-deterministic). After publishing, this script runs
REM merge-appsettings.ps1 to deterministically deep-merge every tool's
REM appsettings.json into a single converged operational file.
REM
REM Usage:
REM   build-tools.cmd [Configuration]
REM
REM   Configuration  Optional. Build configuration to use. Defaults to Release.
REM
REM Examples:
REM   build-tools.cmd
REM   build-tools.cmd Debug
REM ============================================================================

setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "TOOLS_DIR=%ROOT%tools"
set "OUTPUT_DIR=%ROOT%binaries"
set "CONFIGURATION=%~1"
if "%CONFIGURATION%"=="" set "CONFIGURATION=Release"

echo ============================================================
echo Building tools from: %TOOLS_DIR%
echo Output folder:       %OUTPUT_DIR%
echo Configuration:       %CONFIGURATION%
echo ============================================================

REM Start from a clean output folder.
if exist "%OUTPUT_DIR%" (
    echo Cleaning existing output folder...
    rmdir /s /q "%OUTPUT_DIR%"
)
mkdir "%OUTPUT_DIR%"

set "FAILED="

REM Discover every .csproj under the tools directory and publish it.
for /r "%TOOLS_DIR%" %%P in (*.csproj) do (
    set "PROJ=%%~fP"
    set "PROJ_NAME=%%~nP"
    echo.
    echo ------------------------------------------------------------
    echo Publishing !PROJ_NAME!
    echo ------------------------------------------------------------
    dotnet publish "!PROJ!" -c %CONFIGURATION% -o "%OUTPUT_DIR%" -p:ErrorOnDuplicatePublishOutputFiles=false
    if errorlevel 1 (
        echo [ERROR] Failed to publish !PROJ_NAME!
        set "FAILED=!FAILED! !PROJ_NAME!"
    )
)

echo.
echo ============================================================
if defined FAILED (
    echo Build FAILED for:!FAILED!
    echo ============================================================
    endlocal
    exit /b 1
)

echo Build succeeded. Binaries collected in:
echo   %OUTPUT_DIR%
echo ============================================================

echo.
echo Converging appsettings.json into a single operational file...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%merge-appsettings.ps1" -ToolsDir "%TOOLS_DIR%" -OutputFile "%OUTPUT_DIR%\appsettings.json"
if errorlevel 1 (
    echo [ERROR] Failed to converge appsettings.json
    endlocal
    exit /b 1
)
echo ============================================================
endlocal
exit /b 0
