# Replaces the icon of a Windows exe with the images of an .ico file (used by build.bat for
# CircuitJS.exe, which starts as a renamed electron.exe).  Needs nothing but Windows itself.
#   powershell -File set-exe-icon.ps1 -Exe CircuitJS.exe -Icon CircuitJS1.ico
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Icon
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class ExeIcon
{
    delegate bool EnumNames(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangs(IntPtr h, IntPtr type, IntPtr name, ushort lang, IntPtr param);

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr LoadLibraryEx(string f, IntPtr h, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeLibrary(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumNames cb, IntPtr p);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr h, IntPtr type, IntPtr name, EnumLangs cb, IntPtr p);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr BeginUpdateResource(string f, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResource(IntPtr h, bool discard);

    static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14;

    public static void Set(string exe, string ico)
    {
        byte[] d = File.ReadAllBytes(ico);
        int n = BitConverter.ToUInt16(d, 4);

        // name and language of the group icon the exe has now: it is replaced in place
        IntPtr name = (IntPtr)1;
        ushort lang = 1033;
        IntPtr lib = LoadLibraryEx(exe, IntPtr.Zero, 2); // LOAD_LIBRARY_AS_DATAFILE
        if (lib != IntPtr.Zero)
        {
            IntPtr found = IntPtr.Zero;
            EnumResourceNames(lib, RT_GROUP_ICON, (h, t, nm, p) => { found = nm; return false; }, IntPtr.Zero);
            if (found != IntPtr.Zero && ((long)found >> 16) == 0)
            {
                name = found;
                EnumResourceLanguages(lib, RT_GROUP_ICON, name, (h, t, nm, l, p) => { lang = l; return false; }, IntPtr.Zero);
            }
            FreeLibrary(lib);
        }

        IntPtr up = BeginUpdateResource(exe, false);
        if (up == IntPtr.Zero) throw new Exception("cannot open " + exe + " for update (is it running?)");
        var grp = new MemoryStream();
        var w = new BinaryWriter(grp);
        w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)n);
        for (int i = 0; i < n; i++)
        {
            int e = 6 + 16 * i;
            uint size = BitConverter.ToUInt32(d, e + 8), off = BitConverter.ToUInt32(d, e + 12);
            byte[] img = new byte[size];
            Array.Copy(d, off, img, 0, size);
            ushort id = (ushort)(1000 + i);
            if (!UpdateResource(up, RT_ICON, (IntPtr)id, lang, img, size)) { EndUpdateResource(up, true); throw new Exception("UpdateResource failed"); }
            w.Write(d, e, 8);          // width, height, colors, reserved, planes, bit count
            w.Write(size); w.Write(id);
        }
        w.Flush();
        byte[] g = grp.ToArray();
        if (!UpdateResource(up, RT_GROUP_ICON, name, lang, g, (uint)g.Length)) { EndUpdateResource(up, true); throw new Exception("UpdateResource failed"); }
        if (!EndUpdateResource(up, false)) throw new Exception("EndUpdateResource failed");
    }
}
'@

[ExeIcon]::Set((Resolve-Path $Exe).Path, (Resolve-Path $Icon).Path)
