<# : standard batch / powershell hybrid
@echo off
setlocal
title IT Asset Manager - Hardware Scanner
echo ========================================================
echo   IT Asset Master - Hardware Scanner
echo   Reading hardware specifications...
echo ========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content -Path '%~f0' -Raw)"
goto :EOF
#>

$SERVER_URL = "http://192.168.10.194:3000"
$SERVER_KEY = "DaniAsset2026!"

$UserName = $env:USERNAME
try {
    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
    $inputName = [Microsoft.VisualBasic.Interaction]::InputBox("Please enter your full name / employee name:", "IT Asset Inventory", $env:USERNAME)
    if (-not [string]::IsNullOrWhiteSpace($inputName)) {
        $UserName = $inputName
    }
} catch {}

$Comp = $env:COMPUTERNAME
Write-Host "[1/4] Scanning System & Motherboard for $Comp ($UserName)..." -ForegroundColor Cyan

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

Write-Host "[2/4] Scanning CPU, RAM & Disks..." -ForegroundColor Cyan

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
    $Disks = Get-CimInstance Win32_DiskDrive -ErrorAction Stop
    $StorageList = foreach ($d in $Disks) {
        $SizeGB = [math]::Round($d.Size / 1GB)
        "$($d.Model) (${SizeGB}GB)"
    }
    $Storage = ($StorageList -join ' / ')
} catch {
    try {
        $Disks = Get-WmiObject Win32_DiskDrive -ErrorAction Stop
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

Write-Host "[3/4] Scanning Connected Monitors..." -ForegroundColor Cyan
$Monitors = "Default Display"
try {
    $MonList = (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue) | ForEach-Object {
        -join [char[]]($_.UserFriendlyName | Where-Object {$_ -ne 0})
    } | Where-Object {$_ -ne ''}
    if ($MonList) { $Monitors = ($MonList -join ' / ') }
} catch {}

Write-Host "[4/4] Sending specifications to IT Asset Server ($SERVER_URL)..." -ForegroundColor Yellow

$Payload = @{
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
} | ConvertTo-Json

try {
    $Headers = @{
        "Content-Type" = "application/json; charset=utf-8"
        "X-IAM-Key" = $SERVER_KEY
    }
    $res = Invoke-RestMethod -Uri "$SERVER_URL/api/assets/scan" -Method Post -Headers $Headers -Body $Payload -TimeoutSec 15
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "[SUCCESS] Specifications successfully sent to server!" -ForegroundColor Green
    Write-Host "Auto-split items: $($res.items_count)" -ForegroundColor Cyan
    Write-Host "Admin can now review and assign property tag in dashboard." -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Could not reach server: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nScan completed! You can close this window." -ForegroundColor Gray
