# OpenSign - local-first kiosk / digital-signage for churches and nonprofits
# Copyright (c) 2026 TheRevDrJ
# Licensed under AGPL-3.0 - see LICENSE file for details
#
# Stops ONLY a stale OpenSign BACKEND process - a pythonw/python running this
# project's uvicorn (app.main:app on port 6101) - and nothing else. Mirrors
# OpenEar's kill_openear.ps1. The frontend is handled by opensign.bat purely by
# its hard-coded port (6100), NOT here, on purpose: you may run several Vite
# servers at once, so this script never matches node/vite by name - that would
# risk killing another project's frontend.
#
# Safety (process-kills are destructive - kill NARROW, never
# broad): a process is a target ONLY if its command line contains BOTH
# 'app.main:app' AND the backend port '6101' - a fingerprint unique to this
# project's backend. An empty match list kills nothing; there is no fall-through
# to a broad match. Each PID is validated > 0 before Stop-Process is called with
# that explicit -Id. Exits with the number of processes killed, so the caller
# (opensign.bat stop) can tell whether anything was running.
#
#   -Quiet    suppress the per-process line (used by 'start' pre-launch cleanup)
#   -DryRun   report what WOULD be killed, kill nothing (verification)

param([switch]$Quiet, [switch]$DryRun)

$targets = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'pythonw.exe' -or $_.Name -eq 'python.exe') -and
    $_.CommandLine -and
    ($_.CommandLine -like '*app.main:app*') -and
    ($_.CommandLine -like '*6101*')
}

$count = 0
foreach ($p in $targets) {
    if ($p.ProcessId -gt 0) {
        if (-not $Quiet) {
            $verb = if ($DryRun) { 'Would kill' } else { 'Killing' }
            Write-Host "  $verb stale OpenSign backend (PID: $($p.ProcessId))..."
        }
        if (-not $DryRun) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
        $count++
    }
}

exit $count
