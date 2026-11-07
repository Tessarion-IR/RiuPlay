# M0 research helper: puts the extension host renderer processes the spike announces into a Windows
# Job Object with a hard per-process memory limit (JOB_OBJECT_LIMIT_PROCESS_MEMORY). Proves whether
# the OS can enforce the limit on a Chromium-sandboxed renderer. Not part of the app.
param([string]$Handshake, [int]$LimitMB = 512)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JobLimit {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED info, uint len);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  public static string Limit(int pid, ulong bytes) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return "CreateJobObject failed " + Marshal.GetLastWin32Error();
    EXTENDED info = new EXTENDED();
    info.Basic.LimitFlags = 0x100; // JOB_OBJECT_LIMIT_PROCESS_MEMORY
    info.ProcessMemoryLimit = new UIntPtr(bytes);
    if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXTENDED)))) return "SetInformationJobObject failed " + Marshal.GetLastWin32Error();
    IntPtr proc = OpenProcess(0x0100 | 0x0001, false, pid); // PROCESS_SET_QUOTA | PROCESS_TERMINATE
    if (proc == IntPtr.Zero) return "OpenProcess failed " + Marshal.GetLastWin32Error();
    if (!AssignProcessToJobObject(job, proc)) return "AssignProcessToJobObject failed " + Marshal.GetLastWin32Error();
    return "ok";
  }
}
"@
$deadline = (Get-Date).AddMinutes(4)
$done = @{}
while ((Get-Date) -lt $deadline -and $done.Count -lt 2) {
  foreach ($w in "heap", "buffers") {
    $pidFile = Join-Path $Handshake "$w.pid"
    if (-not $done.ContainsKey($w) -and (Test-Path $pidFile)) {
      $targetPid = [int](Get-Content $pidFile)
      $result = [JobLimit]::Limit($targetPid, [uint64]$LimitMB * 1MB)
      Set-Content -Path (Join-Path $Handshake "$w.assigned") -Value $result
      Write-Output "$w pid=$targetPid -> $result"
      $done[$w] = $true
    }
  }
  Start-Sleep -Milliseconds 100
}
