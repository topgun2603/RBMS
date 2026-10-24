# Sends the bytes of -File to the Windows printer named -Printer as a RAW job (no driver rendering).
# Called by bridge.mjs with fixed arguments; the printer name comes from the bridge's config file.
param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);
}
'@

$bytes = [System.IO.File]::ReadAllBytes($File)
$h = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($Printer, [ref]$h, [IntPtr]::Zero)) { throw "Cannot open printer '$Printer' (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
try {
  $di = New-Object RawPrinter+DOCINFO
  $di.pDocName = 'SriKit receipt'
  $di.pDataType = 'RAW'
  if (-not [RawPrinter]::StartDocPrinter($h, 1, $di)) { throw "StartDocPrinter failed" }
  try {
    [void][RawPrinter]::StartPagePrinter($h)
    $w = 0
    if (-not [RawPrinter]::WritePrinter($h, $bytes, $bytes.Length, [ref]$w)) { throw "WritePrinter failed" }
    [void][RawPrinter]::EndPagePrinter($h)
  } finally { [void][RawPrinter]::EndDocPrinter($h) }
} finally { [void][RawPrinter]::ClosePrinter($h) }
