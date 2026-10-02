<# : standard batch / powershell hybrid
@echo off
setlocal
title IT Asset Manager - USB Hardware Scanner
echo ========================================================
echo   IT Asset Master - USB Hardware Scanner
echo   Reading hardware specifications...
echo ========================================================
echo.

set "KIT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content -Path '%~f0' -Raw)"
goto :EOF
#>

$SERVER_URLS = @("http://192.168.10.194:3000")
# First address that answers wins (LAN inside the office, public address from outside)
function Find-Server {
    foreach ($u in $SERVER_URLS) {
        try { Invoke-WebRequest -Uri "$u/login.html" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $u } catch {}
    }
    return $null
}
$SERVER_KEY = "SET-AUTOMATICALLY-ON-DOWNLOAD"

$UserName = $env:USERNAME
try {
    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
    $inputName = [Microsoft.VisualBasic.Interaction]::InputBox("Please enter your full name / employee name:", "IT Asset Inventory", $env:USERNAME)
    if (-not [string]::IsNullOrWhiteSpace($inputName)) {
        $UserName = $inputName
    }
} catch {}

$Comp = $env:COMPUTERNAME
Write-Host "[1/5] Scanning System & Motherboard for $Comp ($UserName)..." -ForegroundColor Cyan

# Model
$Model = ""
try { $SysInfo = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop; $Model = "$($SysInfo.Manufacturer) $($SysInfo.Model)".Trim() } catch {}
if (-not $Model) {
    try { $SysInfo = Get-WmiObject Win32_ComputerSystem -ErrorAction Stop; $Model = "$($SysInfo.Manufacturer) $($SysInfo.Model)".Trim() } catch {}
}
if (-not $Model) {
    try { $Model = (Get-ItemProperty -Path "HKLM:\HARDWARE\DESCRIPTION\System\BIOS" -Name "SystemProductName" -ErrorAction SilentlyContinue).SystemProductName } catch {}
}
if (-not $Model) { $Model = "$env:COMPUTERNAME System" }

# Serial Number
$Serial = ""
try { $Serial = (Get-CimInstance Win32_Bios -ErrorAction Stop).SerialNumber } catch {}
if (-not $Serial) {
    try { $Serial = (Get-WmiObject Win32_Bios -ErrorAction Stop).SerialNumber } catch {}
}
if (-not $Serial) {
    try { $Serial = (Get-ItemProperty -Path "HKLM:\HARDWARE\DESCRIPTION\System\BIOS" -Name "SystemSerialNumber" -ErrorAction SilentlyContinue).SystemSerialNumber } catch {}
}
if ([string]::IsNullOrWhiteSpace($Serial)) { $Serial = "Unknown" }

# OS Version
$OS = [System.Environment]::OSVersion.VersionString
try { $OS = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch {
    try { $OS = (Get-WmiObject Win32_OperatingSystem -ErrorAction Stop).Caption } catch {
        try { $OS = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -Name "ProductName" -ErrorAction SilentlyContinue).ProductName } catch {}
    }
}

# IP Address
$IP = ""
try {
    $Adapters = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    $IP = ($Adapters.IPAddress | Select-Object -Unique) -join " / "
} catch {
    try {
        $IPList = [System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '127.*' } | ForEach-Object { $_.IPAddressToString }
        $IP = ($IPList | Select-Object -Unique) -join ' / '
    } catch {}
}
if (-not $IP) { $IP = "127.0.0.1" }

Write-Host "[2/5] Scanning CPU, RAM & Disks..." -ForegroundColor Cyan

# CPU
$CPU = $env:PROCESSOR_IDENTIFIER
try { $CPU = (Get-CimInstance Win32_Processor -ErrorAction Stop).Name } catch {
    try { $CPU = (Get-WmiObject Win32_Processor -ErrorAction Stop).Name } catch {
        try { $CPU = (Get-ItemProperty -Path "HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0" -Name "ProcessorNameString" -ErrorAction SilentlyContinue).ProcessorNameString } catch {}
    }
}

# RAM
$RAM = ""
try {
    $Mem = Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop
    $RAM_GB = [math]::round((($Mem | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
    $RAM = "${RAM_GB} GB"
} catch {
    try {
        $Mem = Get-WmiObject Win32_PhysicalMemory -ErrorAction Stop
        $RAM_GB = [math]::round((($Mem | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
        $RAM = "${RAM_GB} GB"
    } catch {
        try {
            $RAM_MB = (Get-ItemProperty -Path "HKLM:\HARDWARE\RESOURCEMAP\System Resources\Physical Memory" -ErrorAction SilentlyContinue)
            $RAM = "Available"
        } catch {}
    }
}
if (-not $RAM) { $RAM = "8 GB (Standard)" }

# Disks
$Storage = ""
try {
    $Disks = Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Where-Object { $_.InterfaceType -ne 'USB' -and $_.MediaType -notmatch 'Removable' }
    $StorageList = foreach ($d in $Disks) {
        $SizeGB = [math]::Round($d.Size / 1GB)
        "$($d.Model) (${SizeGB}GB)"
    }
    $Storage = ($StorageList -join ' / ')
} catch {
    try {
        $Disks = Get-WmiObject Win32_DiskDrive -ErrorAction Stop | Where-Object { $_.InterfaceType -ne 'USB' -and $_.MediaType -notmatch 'Removable' }
        $StorageList = foreach ($d in $Disks) {
            $SizeGB = [math]::Round($d.Size / 1GB)
            "$($d.Model) (${SizeGB}GB)"
        }
        $Storage = ($StorageList -join ' / ')
    } catch {
        $Storage = "Internal Storage"
    }
}

# C Space
$CSpace = "Unknown"
try {
    $drive = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -like "C:*" }
    if ($drive) {
        $FreeGB = [math]::Round($drive.AvailableFreeSpace / 1GB)
        $TotalGB = [math]::Round($drive.TotalSize / 1GB)
        $CSpace = "${FreeGB} GB free of ${TotalGB} GB"
    }
} catch {}

# GPU
$GPU = ""
try { $GPU = (((Get-CimInstance Win32_VideoController -ErrorAction Stop).Name -join ' / ')) } catch {
    try { $GPU = (((Get-WmiObject Win32_VideoController -ErrorAction Stop).Name -join ' / ')) } catch {
        $GPU = "Standard Graphics"
    }
}

Write-Host "[3/5] Scanning Connected Monitors..." -ForegroundColor Cyan
$Monitors = "Default Display"
try {
    $MonList = (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue) | ForEach-Object {
        -join [char[]]($_.UserFriendlyName | Where-Object {$_ -ne 0})
    } | Where-Object {$_ -ne ''}
    if ($MonList) { $Monitors = ($MonList -join ' / ') }
} catch {}

Write-Host "[4/5] Checking drive health (SMART)..." -ForegroundColor Cyan
$IsAdmin = $false
try {
    $IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}

# SMART failure prediction per device (needs administrator; ATA/SATA drives)
$Predict = @{}
try {
    Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop | ForEach-Object {
        $Predict[[string]$_.InstanceName] = [bool]$_.PredictFailure
    }
} catch {}

$DiskHealth = @()
try {
    $PhysDisks = Get-PhysicalDisk -ErrorAction Stop | Where-Object { [string]$_.BusType -ne 'USB' }
    foreach ($pd in $PhysDisks) {
        $rel = $null
        try { $rel = $pd | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}

        $pf = $null
        try {
            $wdd = Get-CimInstance Win32_DiskDrive -Filter "Index=$($pd.DeviceId)" -ErrorAction Stop
            if ($wdd -and $wdd.PNPDeviceID) {
                foreach ($k in $Predict.Keys) { if ($k -like "$($wdd.PNPDeviceID)*") { $pf = $Predict[$k] } }
            }
        } catch {}

        $bus = [string]$pd.BusType
        $type = [string]$pd.MediaType
        if ($type -eq 'Unspecified' -or $type -eq '0') { $type = '' }
        if ($bus -eq 'NVMe') { $type = 'NVMe' }
        $isSolid = ($type -eq 'SSD' -or $type -eq 'NVMe')

        $wear = $null; $temp = $null; $hours = $null; $uncorr = $null
        if ($rel) {
            if ($isSolid -and $null -ne $rel.Wear) { $wear = [int]$rel.Wear }
            if ($rel.Temperature) { $temp = [int]$rel.Temperature }
            if ($rel.PowerOnHours) { $hours = [int]$rel.PowerOnHours }
            if ($null -ne $rel.ReadErrorsUncorrected) { $uncorr = [int]$rel.ReadErrorsUncorrected }
        }

        $DiskHealth += [ordered]@{
            model = ([string]$pd.FriendlyName).Trim()
            serial = ([string]$pd.SerialNumber).Trim()
            type = $type
            bus = $bus
            size_gb = [math]::Round($pd.Size / 1GB)
            health_status = [string]$pd.HealthStatus
            wear_percent = $wear
            temperature_c = $temp
            power_on_hours = $hours
            uncorrectable_errors = $uncorr
            predict_failure = $pf
        }
    }
} catch {
    # Older Windows without the Storage module: fall back to Win32_DiskDrive status (OK / Pred Fail)
    try {
        foreach ($d in (Get-CimInstance Win32_DiskDrive -ErrorAction Stop | Where-Object { $_.InterfaceType -ne 'USB' -and $_.MediaType -notmatch 'Removable' })) {
            $st = [string]$d.Status
            $hs = if ($st -eq 'OK') { 'Healthy' } elseif ($st -eq 'Pred Fail') { 'Pred Fail' } else { $st }
            $DiskHealth += [ordered]@{
                model = ([string]$d.Model).Trim()
                serial = ([string]$d.SerialNumber).Trim()
                type = ''
                bus = [string]$d.InterfaceType
                size_gb = [math]::Round($d.Size / 1GB)
                health_status = $hs
                predict_failure = ($st -eq 'Pred Fail')
            }
        }
    } catch {}
}

foreach ($dh in $DiskHealth) {
    $line = "      - $($dh.model): $($dh.health_status)"
    if ($null -ne $dh.wear_percent) { $line += " | life left: $(100 - $dh.wear_percent)%" }
    if ($dh.temperature_c) { $line += " | $($dh.temperature_c) C" }
    if ($dh.predict_failure -eq $true) { $line += " | SMART: FAILURE PREDICTED!" }
    $color = if ($dh.predict_failure -eq $true -or $dh.health_status -eq 'Unhealthy') { 'Red' } elseif ($dh.health_status -eq 'Warning') { 'Yellow' } else { 'Gray' }
    Write-Host $line -ForegroundColor $color
}
if (-not $IsAdmin) {
    Write-Host "      Tip: run this scanner as Administrator for full SMART data (wear %, temperature, errors)." -ForegroundColor DarkYellow
}

Write-Host "[5/5] Looking for the IT Asset Server..." -ForegroundColor Yellow
$SERVER_URL = Find-Server
if ($SERVER_URL) { Write-Host "      Using $SERVER_URL" -ForegroundColor Gray }

$Payload = [ordered]@{
    userName = $UserName
    computerName = $Comp
    model = $Model
    serialNumber = $Serial
    os = $OS
    ip = $IP
    cpu = $CPU
    ram = $RAM
    storage = $Storage
    cSpace = $CSpace
    gpu = $GPU
    monitors = $Monitors
    diskHealth = @($DiskHealth)
    scannedAt = (Get-Date).ToString("s")
    source = "usb-kit"
}
$Json = $Payload | ConvertTo-Json -Depth 6

# USB kit folders (next to this .bat on the flash drive)
$KitDir = $env:KIT_DIR
if (-not $KitDir) { $KitDir = (Get-Location).Path }
$ScanDir = Join-Path $KitDir "scans"
$SentDir = Join-Path $ScanDir "sent"
foreach ($d in @($ScanDir, $SentDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

$Headers = @{ "X-IAM-Key" = $SERVER_KEY }
function Send-Scan([string]$body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri "$SERVER_URL/api/assets/scan" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 15
}

$SafeName = ($Comp -replace '[^A-Za-z0-9_-]', '_')
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$FileName = "${SafeName}_${Stamp}.json"

$Online = $false
try {
    if (-not $SERVER_URL) { throw "no server reachable" }
    $res = Send-Scan $Json
    $Online = $true
    [System.IO.File]::WriteAllText((Join-Path $SentDir $FileName), $Json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "[SUCCESS] Sent to the server. Items found: $($res.items_count)" -ForegroundColor Green
    Write-Host "Admin can now review it in the dashboard (Pending scans)." -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} catch {
    # Offline = bench / workshop scan: the screen attached is only a test monitor, so it is left out
    $Payload.monitors = ""
    $Payload["offline"] = $true
    $Json = $Payload | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $ScanDir $FileName), $Json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host "[SAVED ON USB] Server not reachable from this computer." -ForegroundColor Yellow
    Write-Host "Saved to: scans\$FileName" -ForegroundColor Yellow
    Write-Host "It will be sent automatically next time this USB runs on a" -ForegroundColor Yellow
    Write-Host "computer that can reach the server, or import it from the panel." -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Yellow
}

# Server reachable: also deliver scans saved earlier on computers without network
if ($Online) {
    $Pending = Get-ChildItem -Path $ScanDir -Filter "*.json" -File -ErrorAction SilentlyContinue
    if ($Pending) {
        Write-Host "Sending $($Pending.Count) scan(s) saved earlier on this USB..." -ForegroundColor Cyan
        foreach ($f in $Pending) {
            try {
                $body = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
                Send-Scan $body | Out-Null
                Move-Item -Path $f.FullName -Destination (Join-Path $SentDir $f.Name) -Force
                Write-Host "   sent: $($f.Name)" -ForegroundColor Gray
            } catch {
                Write-Host "   failed: $($f.Name) - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

Write-Host "`nScan completed! You can unplug the USB." -ForegroundColor Gray
Start-Sleep -Seconds 6
