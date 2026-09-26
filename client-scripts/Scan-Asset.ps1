<#
.SYNOPSIS
    IT Asset Master Scanner Script
.DESCRIPTION
    Collects full PC hardware specifications, serial numbers, monitors, and specs,
    then automatically pushes the data to the central IT Asset Management server.
#>
param(
    [string]$ServerUrl = "http://localhost:3000",
    [string]$UserName = $env:USERNAME
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Gathering Hardware Specs..." -ForegroundColor Cyan

$Comp = $env:COMPUTERNAME
$SysInfo = Get-CimInstance Win32_ComputerSystem
$Model = "$($SysInfo.Manufacturer) $($SysInfo.Model)" -replace '"',''

$Serial = (Get-CimInstance Win32_Bios).SerialNumber -replace '"',''
if ([string]::IsNullOrEmpty($Serial)) { $Serial = "Unknown" }

$OS = (Get-CimInstance Win32_OperatingSystem).Caption -replace '"',''

$Adapters = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true }
$ActiveAdapters = $Adapters | Where-Object { $_.DefaultIPGateway -ne $null -and $_.Description -notmatch 'VMware|VirtualBox|Virtual Ethernet|vEthernet|Loopback' }
if (-not $ActiveAdapters) { $ActiveAdapters = $Adapters }
$IPList = foreach ($a in $ActiveAdapters) { $a.IPAddress | Where-Object { $_ -like '*.*' } }
$IP = ($IPList | Select-Object -Unique) -join ' / '
if ([string]::IsNullOrEmpty($IP)) { $IP = "No IP Found" }

$CPU = (Get-CimInstance Win32_Processor).Name -replace '"',''

$Mem = Get-CimInstance Win32_PhysicalMemory
if ($Mem) {
    $RAM_GB = [math]::round((($Mem | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
} else {
    $RAM_GB = [math]::round((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize / 1MB)
}
$RAM = "${RAM_GB} GB"

$Disks = Get-CimInstance Win32_DiskDrive
$StorageList = foreach ($d in $Disks) {
    $SizeGB = [math]::Round($d.Size / 1GB)
    "$($d.Model) (${SizeGB}GB)"
}
$Storage = ($StorageList -join ' / ') -replace '"',''

$CDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if ($CDrive) {
    $FreeGB = [math]::Round($CDrive.FreeSpace / 1GB)
    $TotalGB = [math]::Round($CDrive.Size / 1GB)
    $CSpace = "${FreeGB} GB free of ${TotalGB} GB"
} else {
    $CSpace = "Unknown"
}

$PhysAdapters = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -eq $true }
$NetList = foreach ($n in $PhysAdapters) { $n.Name }
$NetworkDevices = ($NetList -join ' / ') -replace '"',''

$GPU = (((Get-CimInstance Win32_VideoController).Name -join ' / ')) -replace '"',''

$MonList = (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID) | ForEach-Object {
    -join [char[]]($_.UserFriendlyName | Where-Object {$_ -ne 0})
} | Where-Object {$_ -ne ''}
$Monitors = ($MonList -join ' / ') -replace '"',''
if ([string]::IsNullOrEmpty($Monitors)) { $Monitors = "Default Display" }

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
    networkDevices = $NetworkDevices
    gpu = $GPU
    monitors = $Monitors
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$ServerUrl/api/assets/scan" -Method Post -ContentType "application/json" -Body $Payload -TimeoutSec 10
    Write-Host "[OK] Asset synced successfully. Property ID: $($response.property_id)" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Could not sync with IT Asset Master: $($_.Exception.Message)" -ForegroundColor Yellow
}
