param(
    [string]$ProjectPath = 'D:\MEU SERVIDOR\PROSPCTADOR DE SITES\google-maps-claude-kit-sales-main',
    [string]$HubOrigin = 'https://hubsystem-phi.vercel.app',
    [string]$PythonPath = '',
    [switch]$AutoStart,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$protocolKey = 'HKCU:\Software\Classes\hubsystem-prospectador'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'HubSystemProspectador'
$installDir = Join-Path $env:LOCALAPPDATA 'HubSystem\Prospectador'

function Stop-Connector {
    # Encerra somente o conector instalado; outros processos Python continuam.
    $script = Join-Path $installDir 'bridge.py'
    Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($script) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

if ($Uninstall) {
    # Caminhos fixos e limitados ao que este instalador registra.
    Stop-Connector
    if (Test-Path -LiteralPath $protocolKey) { Remove-Item -LiteralPath $protocolKey -Recurse }
    Remove-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue
    Write-Output 'Conector removido. Os dados do prospectador foram preservados.'
    exit
}
$project = (Resolve-Path -LiteralPath $ProjectPath).Path
foreach ($file in @('docker-compose.yml', 'painel\server.py', 'scripts\scrape.py')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project $file))) { throw "Projeto incompleto: $file" }
}
$origin = [uri]$HubOrigin
if ($origin.Scheme -ne 'https' -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) {
    throw 'HubOrigin deve ser apenas a origem HTTPS, sem caminho, query ou fragmento.'
}
if (-not $PythonPath) {
    $candidates = @(Get-ChildItem -LiteralPath "$env:LOCALAPPDATA\Programs\Python" -Filter 'Python*' -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'python.exe' } | Where-Object { Test-Path -LiteralPath $_ })
    if ($candidates.Count -eq 0) { throw 'Informe -PythonPath com o caminho do Python 3 instalado.' }
    $PythonPath = $candidates[-1]
}
$python = (Resolve-Path -LiteralPath $PythonPath).Path
$pythonw = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) { throw 'pythonw.exe não encontrado junto ao Python.' }
$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$compose = Join-Path (Split-Path (Split-Path $docker)) 'cli-plugins\docker-compose.exe'
if (-not (Test-Path -LiteralPath $compose)) { throw 'Executável do Docker Compose não encontrado no Docker Desktop.' }
$desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path -LiteralPath $desktop)) { throw 'Docker Desktop não encontrado.' }
$port = '8080'
$envFile = Join-Path $project '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*SCRAPER_PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $port = $Matches[1] }
    }
}
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Stop-Connector
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bridge.py') -Destination $installDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'compose.hub.yml') -Destination $installDir -Force
$configPath = Join-Path $installDir 'config.json'
@{
    project = $project; docker = $docker; compose = $compose; dockerDesktop = $desktop
    scraperUrl = "http://127.0.0.1:$port"
    origins = @($origin.GetLeftPart([System.UriPartial]::Authority), 'http://localhost:3000', 'http://127.0.0.1:3000')
} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
New-Item -Path "$protocolKey\shell\open\command" -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:HubSystem Prospectador'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
# Intencionalmente sem %1: nenhuma parte da URL vira argumento ou comando do Windows.
$command = '"' + $pythonw + '" "' + (Join-Path $installDir 'bridge.py') + '" --config "' + $configPath + '" --launch'
Set-Item -LiteralPath "$protocolKey\shell\open\command" -Value $command
if ($AutoStart) {
    # O conector só escuta em 127.0.0.1; o Docker continua ligando apenas ao abrir o Prospectador.
    $logon = '"' + $pythonw + '" "' + (Join-Path $installDir 'bridge.py') + '" --config "' + $configPath + '"'
    New-ItemProperty -LiteralPath $runKey -Name $runName -Value $logon -PropertyType String -Force | Out-Null
}
Start-Process -FilePath $pythonw -ArgumentList @('"' + (Join-Path $installDir 'bridge.py') + '"', '--config', '"' + $configPath + '"')
Write-Output "Conector instalado em $installDir e ligado. Inicia com o Windows: $([bool]$AutoStart)."
