// RiuPlay M2: a hard, OS-enforced memory cap for extension host processes on Windows.
//
// M0 showed that nothing limits a sandboxed Chromium renderer's memory by default, that a watchdog
// overshoots by gigabytes, and that a Windows Job Object with JOB_OBJECT_LIMIT_PROCESS_MEMORY stops
// a renderer at the cap (heap and off-heap alike) on Electron 45. Node/Electron expose no Job Object
// API, so one long-lived helper - a PowerShell process the app starts once, running only the small
// P/Invoke class below - assigns each extension host renderer to a job of its own. The helper never
// sees extension code or data: it reads "<pid> <limitMB>" lines and answers "<pid> ok|<error>".
//
// The limit is reported per host: a host whose assignment failed (helper unavailable, not Windows)
// is NOT described as memory-limited, and the timeouts/kill on overrun still apply.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { logger } from "../../../core/logger";

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RiuPlayJob {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED info, uint len);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  public static string Limit(int pid, ulong bytes) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return "CreateJobObject " + Marshal.GetLastWin32Error();
    EXTENDED info = new EXTENDED();
    info.Basic.LimitFlags = 0x100; // JOB_OBJECT_LIMIT_PROCESS_MEMORY
    info.ProcessMemoryLimit = new UIntPtr(bytes);
    if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(EXTENDED)))) return "SetInformationJobObject " + Marshal.GetLastWin32Error();
    IntPtr proc = OpenProcess(0x0100 | 0x0001, false, pid);
    if (proc == IntPtr.Zero) return "OpenProcess " + Marshal.GetLastWin32Error();
    bool ok = AssignProcessToJobObject(job, proc);
    int err = Marshal.GetLastWin32Error();
    CloseHandle(proc);
    // The job handle is kept open for the helper's lifetime; the limit stays with the process.
    return ok ? "ok" : "AssignProcessToJobObject " + err;
  }
}
"@
[Console]::Out.WriteLine("ready")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Trim().Split(' ')
  if ($parts.Length -ne 2) { continue }
  try { $r = [RiuPlayJob]::Limit([int]$parts[0], [uint64]$parts[1] * 1MB) } catch { $r = "error" }
  [Console]::Out.WriteLine("$($parts[0]) $r")
}
`;

export interface JobGuard {
  /** Puts `pid` into a job capped at `limitMB`. Resolves true only when Windows confirmed it. */
  limit(pid: number, limitMB: number): Promise<boolean>;
  dispose(): void;
}

export function createJobGuard(options: { spawnHelper?: () => ChildProcessWithoutNullStreams; timeoutMs?: number } = {}): JobGuard {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<boolean> | null = null;
  const waiting = new Map<number, (ok: boolean) => void>();
  let buffer = "";

  function start(): Promise<boolean> {
    if (ready) return ready;
    if (process.platform !== "win32" && !options.spawnHelper) return (ready = Promise.resolve(false));
    ready = new Promise<boolean>((resolve) => {
      try {
        child =
          options.spawnHelper?.() ??
          // The script goes in as -EncodedCommand (UTF-16LE base64), so stdin carries only data.
          spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")], { windowsHide: true, stdio: "pipe" });
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => resolve(false), options.timeoutMs ?? 20_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line === "ready") {
            clearTimeout(timer);
            resolve(true);
            continue;
          }
          const [pidText, result] = line.split(" ");
          const done = waiting.get(Number(pidText));
          if (done) {
            waiting.delete(Number(pidText));
            if (result !== "ok") logger.warn("ext-host", `memory limit not applied to host ${pidText}: ${result}`);
            done(result === "ok");
          }
        }
      });
      child.on("error", () => resolve(false));
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(false);
        for (const done of waiting.values()) done(false);
        waiting.clear();
        child = null;
        ready = null;
      });
    });
    return ready;
  }

  return {
    async limit(pid, limitMB) {
      if (!Number.isInteger(pid) || pid <= 0) return false;
      if (!(await start()) || !child) return false;
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(pid);
          resolve(false);
        }, options.timeoutMs ?? 20_000);
        waiting.set(pid, (ok) => {
          clearTimeout(timer);
          resolve(ok);
        });
        child!.stdin.write(`${pid} ${Math.max(64, Math.round(limitMB))}\n`);
      });
    },
    dispose() {
      child?.kill();
      child = null;
      ready = null;
    },
  };
}
