param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$Entry, [string]$RuntimePatch)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# The Job handle belongs only to this supervisor. Closing/killing the supervisor
# terminates every descendant, even if the original node process already exited.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class DshProbeJob {
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC basic; public IO_COUNTERS io; public UIntPtr a,b,c,d; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string b);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref EXTENDED data, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static int Run(string node, string entry, string patch) {
        var job=CreateJobObject(IntPtr.Zero,null);
        if(job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        Process proc=null;
        try {
            var info=new EXTENDED(); info.basic.flags=0x2000;
            if(!SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info))) throw new System.ComponentModel.Win32Exception();
            var args=String.IsNullOrEmpty(patch) ? "web --no-open --host 127.0.0.1 --port 0" : "--profile web --patch \""+patch+"\" --no-open --host 127.0.0.1 --port 3080";
            var start=new ProcessStartInfo(node,"\""+entry+"\" "+args);
            start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
            proc=new Process();proc.StartInfo=start;
            proc.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Console.Out.WriteLine(e.Data);};
            proc.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Console.Error.WriteLine(e.Data);};
            proc.Start();
            if(!AssignProcessToJobObject(job,proc.Handle)) {proc.Kill();throw new System.ComponentModel.Win32Exception();}
            proc.BeginOutputReadLine();proc.BeginErrorReadLine();
            while(!proc.WaitForExit(1000)) {}
            CloseHandle(job);job=IntPtr.Zero;
            proc.WaitForExit();return proc.ExitCode;
        } finally { if(job!=IntPtr.Zero)CloseHandle(job);if(proc!=null)proc.Dispose(); }
    }
}
'@
exit [DshProbeJob]::Run($NodePath, $Entry, $RuntimePatch)
