// RiuPlay: riuplay-sandbox.exe - starts one program confined, for the APK (Java) source host.
//
//   riuplay-sandbox.exe --name <AppContainer name> [--read <dir>]... [--write <dir>]... [--memory-mb <n>]
//                       [--env NAME=VALUE]... -- <program> [args...]
//
// The program runs:
//   * in a Windows AppContainer with NO capabilities: it cannot open a network connection (not even to
//     loopback), and it can open only the files and folders whose ACL names its AppContainer SID or ALL
//     APPLICATION PACKAGES - here the folders given by --read (read and execute) and --write (modify);
//     the person's documents, profile and other applications' data are out of reach;
//   * in a Job Object: one process at most (it cannot start others), a memory ceiling, no clipboard,
//     desktop or system-settings access, and killed when this launcher goes away;
//   * with extension points (AppInit DLLs and the like) and remote or low-integrity images disabled by
//     process mitigation policy. (The child-process mitigation is not used: it stops the console host a
//     console program needs. The Job's one-process limit is what blocks child processes.)
//   * with only its three standard handles inherited and a minimal environment: SystemRoot, SystemDrive and
//     the profile folder variables Windows needs to set up the AppContainer's own folders (their contents
//     stay out of reach), plus what --env adds. Nothing else of the person's environment is passed on.
// Its standard input, output and error are this launcher's own, so the parent speaks to it over them; that
// is its only way out. The launcher exits with the program's exit code. Licensed GPL-3.0-only with RiuPlay.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

internal static class RiuPlaySandbox
{
    private static int Main(string[] args)
    {
        try
        {
            return Run(args);
        }
        catch (Exception error)
        {
            var win32 = error as Win32Exception;
            Console.Error.WriteLine("riuplay-sandbox: " + error.Message + (win32 != null ? " (error " + win32.NativeErrorCode + ")" : ""));
            return 120;
        }
    }

    private static int Run(string[] args)
    {
        string name = null;
        var reads = new List<string>();
        var writes = new List<string>();
        var env = new List<string>();
        long memoryMb = 2048;
        int i = 0;
        for (; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--") { i++; break; }
            if (i + 1 >= args.Length) throw new ArgumentException("Missing value for " + a);
            string v = args[++i];
            switch (a)
            {
                case "--name": name = v; break;
                case "--read": reads.Add(Path.GetFullPath(v)); break;
                case "--write": writes.Add(Path.GetFullPath(v)); break;
                case "--memory-mb": memoryMb = long.Parse(v); break;
                case "--env": env.Add(v); break;
                default: throw new ArgumentException("Unknown option " + a);
            }
        }
        if (name == null || i >= args.Length) throw new ArgumentException("Usage: --name <name> [options] -- <program> [args]");
        string program = Path.GetFullPath(args[i]);
        var programArgs = new List<string>();
        for (int j = i; j < args.Length; j++) programArgs.Add(j == i ? program : args[j]);

        IntPtr sid = AppContainerSid(name);
        var identity = new SecurityIdentifier(sid);
        foreach (string dir in reads) Grant(dir, identity, FileSystemRights.ReadAndExecute);
        foreach (string dir in writes)
        {
            Directory.CreateDirectory(dir);
            Grant(dir, identity, FileSystemRights.Modify);
        }

        IntPtr job = CreateConfinedJob(memoryMb);

        // Only the standard handles are inherited, each once.
        var handles = new List<IntPtr>();
        IntPtr stdin = GetStdHandle(STD_INPUT_HANDLE), stdout = GetStdHandle(STD_OUTPUT_HANDLE), stderr = GetStdHandle(STD_ERROR_HANDLE);
        foreach (IntPtr h in new[] { stdin, stdout, stderr })
        {
            if (h == IntPtr.Zero || h == INVALID_HANDLE || handles.Contains(h)) continue;
            if (!SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) throw new Win32Exception();
            handles.Add(h);
        }

        var caps = new SECURITY_CAPABILITIES { AppContainerSid = sid, Capabilities = IntPtr.Zero, CapabilityCount = 0, Reserved = 0 };
        IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
        Marshal.StructureToPtr(caps, capsPtr, false);
        IntPtr handleList = Marshal.AllocHGlobal(IntPtr.Size * Math.Max(1, handles.Count));
        for (int k = 0; k < handles.Count; k++) Marshal.WriteIntPtr(handleList, k * IntPtr.Size, handles[k]);
        IntPtr jobList = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(jobList, job);
        IntPtr mitigation = Marshal.AllocHGlobal(8);
        Marshal.WriteInt64(mitigation, MITIGATION_EXTENSION_POINT_DISABLE | MITIGATION_IMAGE_LOAD_NO_REMOTE | MITIGATION_IMAGE_LOAD_NO_LOW_LABEL);

        IntPtr size = IntPtr.Zero;
        const int attributeCount = 4;
        InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
        IntPtr attributes = Marshal.AllocHGlobal(size);
        if (!InitializeProcThreadAttributeList(attributes, attributeCount, 0, ref size)) throw new Win32Exception();
        Update(attributes, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capsPtr, Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
        if (handles.Count > 0) Update(attributes, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleList, IntPtr.Size * handles.Count);
        Update(attributes, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobList, IntPtr.Size);
        Update(attributes, PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY, mitigation, 8);

        var startup = new STARTUPINFOEX();
        startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = stdin;
        startup.StartupInfo.hStdOutput = stdout;
        startup.StartupInfo.hStdError = stderr;
        startup.lpAttributeList = attributes;

        string commandLine = string.Join(" ", programArgs.ConvertAll(Quote));
        // A raw buffer: the block is NUL-separated and must reach CreateProcess whole.
        IntPtr environment = Marshal.StringToHGlobalUni(EnvironmentBlock(env));
        PROCESS_INFORMATION process;
        if (!CreateProcessW(program, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                environment, Path.GetDirectoryName(program), ref startup, out process))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "The program could not be started confined");
        }
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        uint code;
        GetExitCodeProcess(process.hProcess, out code);
        CloseHandle(process.hProcess);
        // The job (and with it anything left of the program) ends when this process exits.
        return unchecked((int)code);
    }

    private static IntPtr AppContainerSid(string name)
    {
        IntPtr sid;
        int hr = CreateAppContainerProfile(name, name, "RiuPlay confined extension host", IntPtr.Zero, 0, out sid);
        if (hr == HRESULT_ALREADY_EXISTS)
        {
            hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
        }
        if (hr != 0) throw new Win32Exception(hr, "No AppContainer (0x" + hr.ToString("x8") + ")");
        return sid;
    }

    private static void Grant(string dir, SecurityIdentifier sid, FileSystemRights rights)
    {
        var info = new DirectoryInfo(dir);
        if (!info.Exists) throw new DirectoryNotFoundException(dir);
        DirectorySecurity security = info.GetAccessControl(AccessControlSections.Access);
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
        {
            if (rule.IdentityReference.Equals(sid) && rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & rights) == rights) return;
        }
        security.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        info.SetAccessControl(security);
    }

    private static IntPtr CreateConfinedJob(long memoryMb)
    {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
        limits.ProcessMemoryLimit = new UIntPtr((ulong)memoryMb * 1024 * 1024);
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(length);
        Marshal.StructureToPtr(limits, ptr, false);
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)length)) throw new Win32Exception();
        IntPtr ui = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(ui, JOB_OBJECT_UILIMIT_ALL);
        if (!SetInformationJobObject(job, JobObjectBasicUIRestrictions, ui, 4)) throw new Win32Exception();
        return job;
    }

    private static void Update(IntPtr list, int attribute, IntPtr value, int size)
    {
        if (!UpdateProcThreadAttribute(list, 0, new IntPtr(attribute), value, new IntPtr(size), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    }

    private static string EnvironmentBlock(List<string> extra)
    {
        var sb = new StringBuilder();
        string root = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        sb.Append("SystemRoot=").Append(root).Append('\0');
        // CreateProcess derives the AppContainer's own folders from these; without them it fails (error 203).
        foreach (string name in new[] { "SystemDrive", "USERPROFILE", "LOCALAPPDATA", "APPDATA" })
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrEmpty(value)) sb.Append(name).Append('=').Append(value).Append('\0');
        }
        foreach (string e in extra)
        {
            if (e.IndexOf('=') <= 0 || e.IndexOf('\0') >= 0) throw new ArgumentException("Bad --env " + e);
            sb.Append(e).Append('\0');
        }
        sb.Append('\0');
        return sb.ToString();
    }

    // The quoting CommandLineToArgvW and the C runtime undo.
    private static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        var sb = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"') sb.Append('\\', backslashes * 2 + 1).Append('"');
            else sb.Append('\\', backslashes).Append(c);
            backslashes = 0;
        }
        sb.Append('\\', backslashes * 2).Append('"');
        return sb.ToString();
    }

    // --- Win32 ---------------------------------------------------------------------------------------------
    private const int STD_INPUT_HANDLE = -10, STD_OUTPUT_HANDLE = -11, STD_ERROR_HANDLE = -12;
    private static readonly IntPtr INVALID_HANDLE = new IntPtr(-1);
    private const uint HANDLE_FLAG_INHERIT = 1;
    private const int HRESULT_ALREADY_EXISTS = unchecked((int)0x800700B7);
    private const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    private const int PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY = 0x00020007;
    private const int PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
    private const int PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
    private const long MITIGATION_EXTENSION_POINT_DISABLE = 0x1L << 32;
    private const long MITIGATION_IMAGE_LOAD_NO_REMOTE = 0x1L << 52;
    private const long MITIGATION_IMAGE_LOAD_NO_LOW_LABEL = 0x1L << 56;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000, CREATE_NO_WINDOW = 0x08000000, CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const uint INFINITE = 0xFFFFFFFF;
    private const int JobObjectBasicUIRestrictions = 4, JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8, JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100,
        JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private const int JOB_OBJECT_UILIMIT_ALL = 0xFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS { public ulong a, b, c, d, e, f; }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr caps, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(string app, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr h);
}
