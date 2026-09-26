@echo off
title "Company Spec & IT Asset Manager Scanner"
echo ====================================================
echo   Gathering your system specifications...
echo   Sending report directly to IT Asset Manager & Bale!
echo   This will only take a couple of seconds.
echo ====================================================
echo.

:: Searches for the marker safely by splitting the text so it won't detect itself
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = [System.IO.File]::ReadAllText('%~f0'); $marker = '<#PS_' + 'START#>'; $idx = $c.IndexOf($marker); if ($idx -ge 0) { $code = $c.Substring($idx + $marker.Length) -replace [char]160, ' '; iex $code } else { Write-Error 'Marker not found' }"

echo.
echo ====================================================
echo   Process Completed! You can close this window.
echo ====================================================
echo.
pause
exit /b

<#PS_START#>
# ========================================================
# CONFIGURATION
# Set your IT Asset Server address & API key
# ========================================================
$SERVER_URL = "http://143.246.138.167:3000"
$SERVER_KEY = "DaniAsset2026!"
$BALE_TOKEN = "545562353:ObCU_Jqc3GU6F6AUFSqc9PncphRtSyAb49g"
$BALE_CHAT_ID = "414212991"
$OutputFile = "system_specs.csv"

# 1. Pop-up window asking for full name (pre-filled with Windows username)
Add-Type -AssemblyName Microsoft.VisualBasic
$UserName = [Microsoft.VisualBasic.Interaction]::InputBox("Please enter your full name:", "IT Asset Inventory", $env:USERNAME)
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = $env:USERNAME }

# Add Header if CSV doesn't exist
if (-not (Test-Path $OutputFile)) {
    Set-Content -Path $OutputFile -Value 'User Name,Computer Name,Manufacturer/Model,Serial Number,OS Version,IP Address,CPU,RAM,Storage Drives,Free C: Space,Network Devices,GPU,Monitors'
}

$Comp = $env:COMPUTERNAME

# Manufacturer & Model (e.g. Dell Latitude 5420 / HP ProDesk)
$SysInfo = Get-CimInstance Win32_ComputerSystem
$Model = "$($SysInfo.Manufacturer) $($SysInfo.Model)" -replace '"',''

# BIOS Serial Number (Crucial for physical asset tracking & warranty)
$Serial = (Get-CimInstance Win32_Bios).SerialNumber -replace '"',''
if ([string]::IsNullOrEmpty($Serial)) { $Serial = "Unknown" }

# Windows OS Edition & Version
$OS = (Get-CimInstance Win32_OperatingSystem).Caption -replace '"',''

# Physical IP Address
$Adapters = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true }
$ActiveAdapters = $Adapters | Where-Object { $_.DefaultIPGateway -ne $null -and $_.Description -notmatch 'VMware|VirtualBox|Virtual Ethernet|vEthernet|Loopback' }
if (-not $ActiveAdapters) { $ActiveAdapters = $Adapters | Where-Object { $_.Description -notmatch 'VMware|VirtualBox|Virtual Ethernet|vEthernet|Loopback' } }
if (-not $ActiveAdapters) { $ActiveAdapters = $Adapters }

$IPList = foreach ($a in $ActiveAdapters) { $a.IPAddress | Where-Object { $_ -like '*.*' } }
$IP = ($IPList | Select-Object -Unique) -join ' / '
if ([string]::IsNullOrEmpty($IP)) { $IP = "No IP Found" }

# CPU
$CPU = (Get-CimInstance Win32_Processor).Name -replace '"',''

# RAM
$Mem = Get-CimInstance Win32_PhysicalMemory
if ($Mem) {
    $RAM_GB = [math]::round((($Mem | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
} else {
    $RAM_GB = [math]::round((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize / 1MB)
}
$RAM = "${RAM_GB} GB"

# Storage Drives
$Disks = Get-CimInstance Win32_DiskDrive
$StorageList = foreach ($d in $Disks) {
    $SizeGB = [math]::Round($d.Size / 1GB)
    "$($d.Model) (${SizeGB}GB)"
}
$Storage = ($StorageList -join ' / ') -replace '"',''

# C: Drive Available Free Space
$CDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if ($CDrive) {
    $FreeGB = [math]::Round($CDrive.FreeSpace / 1GB)
    $TotalGB = [math]::Round($CDrive.Size / 1GB)
    $CSpace = "${FreeGB} GB free of ${TotalGB} GB"
} else {
    $CSpace = "Unknown"
}

# Physical Network Devices
$PhysAdapters = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -eq $true }
$NetList = foreach ($n in $PhysAdapters) { $n.Name }
$NetworkDevices = ($NetList -join ' / ') -replace '"',''

# GPU
$GPU = (((Get-CimInstance Win32_VideoController).Name -join ' / ')) -replace '"',''

# Monitors
$MonList = (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID) | ForEach-Object {
    -join [char[]]($_.UserFriendlyName | Where-Object {$_ -ne 0})
} | Where-Object {$_ -ne ''}
$Monitors = ($MonList -join ' / ') -replace '"',''
if ([string]::IsNullOrEmpty($Monitors)) { $Monitors = "Default Display" }

# 1. Write to local CSV
$Row = '"{0}","{1}","{2}","{3}","{4}","{5}","{6}","{7}","{8}","{9}","{10}","{11}","{12}"' -f $UserName, $Comp, $Model, $Serial, $OS, $IP, $CPU, $RAM, $Storage, $CSpace, $NetworkDevices, $GPU, $Monitors
Add-Content -Path $OutputFile -Value $Row
Write-Host "[OK] Saved to local CSV: $OutputFile" -ForegroundColor Green

# 2. Upload to IT Asset Master Web App
Write-Host "Syncing with IT Asset Manager Web Server ($SERVER_URL)..." -ForegroundColor Cyan
$ApiUrl = "$SERVER_URL/api/assets/scan"
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
    $Headers = @{ "X-IAM-Key" = $SERVER_KEY }
    $ApiResponse = Invoke-RestMethod -Uri $ApiUrl -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $Payload -TimeoutSec 10
    if ($ApiResponse.success) {
        Write-Host "--------------------------------------------------------" -ForegroundColor Green
        Write-Host "[SUCCESS] Device registered in IT Asset Master!" -ForegroundColor Green
        Write-Host "Property ID: $($ApiResponse.property_id)" -ForegroundColor Yellow
        Write-Host "Link to add photos: $SERVER_URL/asset.html?id=$($ApiResponse.asset_id)" -ForegroundColor Cyan
        Write-Host "--------------------------------------------------------" -ForegroundColor Green
    }
} catch {
    Write-Host "[NOTICE] Could not connect to Web Server: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Specs are saved locally in $OutputFile." -ForegroundColor Yellow
}

# 3. Send to Bale Bot
if ($BALE_TOKEN -ne "YOUR_BALE_BOT_TOKEN_HERE" -and $BALE_CHAT_ID -ne "YOUR_BALE_CHAT_ID_HERE") {
    Write-Host "Uploading details to Bale Messenger..." -ForegroundColor Cyan
    try {
        $text = "🖥️ *New System Spec Report*`n`n" +
        "*User:* $UserName`n" +
        "*Computer Name:* $Comp`n" +
        "*Model:* $Model`n" +
        "*Serial Number:* $Serial`n" +
        "*OS:* $OS`n" +
        "*IP Address:* $IP`n" +
        "*CPU:* $CPU`n" +
        "*RAM:* $RAM`n" +
        "*Storage Drives:* $Storage`n" +
        "*C: Drive Space:* $CSpace`n" +
        "*Network:* $NetworkDevices`n" +
        "*GPU:* $GPU`n" +
        "*Monitor(s):* $Monitors"

        $MsgUrl = "https://tapi.bale.ai/bot$BALE_TOKEN/sendMessage"
        $MsgBody = @{ chat_id = $BALE_CHAT_ID; text = $text; parse_mode = "Markdown" } | ConvertTo-Json
        [void](Invoke-RestMethod -Uri $MsgUrl -Method Post -ContentType "application/json" -Body $MsgBody)

        $DocUrl = "https://tapi.bale.ai/bot$BALE_TOKEN/sendDocument"
        $boundary = [System.Guid]::NewGuid().ToString()
        $LF = "`r`n"
        $fileBytes = [System.IO.File]::ReadAllBytes($OutputFile)
        $fileEnc = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes)

        $bodyLines = @(
            "--$boundary",
            'Content-Disposition: form-data; name="chat_id"',
            "",
            "$BALE_CHAT_ID",
            "--$boundary",
            "Content-Disposition: form-data; name=`"document``; filename=`"${Comp}_specs.csv`"",
            'Content-Type: text/csv',
            "",
            $fileEnc,
            "--$boundary--"
        ) -join $LF

        [void](Invoke-RestMethod -Uri $DocUrl -Method Post -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines)
        Write-Host "Success! Specs and file sent to Bale." -ForegroundColor Green
    }
    catch {
        Write-Host "Could not send to Bale Bot: $($_.Exception.Message)" -ForegroundColor Red
    }
}
