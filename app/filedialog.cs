// Native Windows open/save dialog for the Electron app (see main.js).
//
// Electron's dialogs only report "cancelled" when they are closed without a
// file, so the folder the user browsed to is lost.  IFileDialog::GetFolder
// still returns it after a cancel, so this helper reports it in both cases.
//
// Usage: filedialog.exe open|save <owner hwnd> <start folder> <file name> <result file>
// (empty strings for the arguments not needed).  The result file gets three
// UTF-8 lines: "ok" or "cancel", the chosen file, the folder shown at the end.
//
// Built by build.bat with the C# compiler that comes with .NET Framework 4.

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
	[PreserveSig] int Show(IntPtr parent);
	void SetFileTypes(uint count, IntPtr specs);
	void SetFileTypeIndex(uint index);
	void GetFileTypeIndex(out uint index);
	void Advise(IFileDialogEvents events, out uint cookie);
	void Unadvise(uint cookie);
	void SetOptions(uint options);
	void GetOptions(out uint options);
	void SetDefaultFolder(IShellItem item);
	void SetFolder(IShellItem item);
	[PreserveSig] int GetFolder(out IShellItem item);
	void GetCurrentSelection(out IShellItem item);
	void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
	void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
	void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
	void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
	void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
	void GetResult(out IShellItem item);
	void AddPlace(IShellItem item, int place);
	void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
	void Close(int hr);
	void SetClientGuid(ref Guid guid);
	void ClearClientData();
	void SetFilter(IntPtr filter);
}

[ComImport, Guid("973510db-7d7f-452b-8975-74a85828d354"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialogEvents {
	[PreserveSig] int OnFileOk(IFileDialog dlg);
	[PreserveSig] int OnFolderChanging(IFileDialog dlg, IShellItem folder);
	[PreserveSig] int OnFolderChange(IFileDialog dlg);
	[PreserveSig] int OnSelectionChange(IFileDialog dlg);
	[PreserveSig] int OnShareViolation(IFileDialog dlg, IShellItem item, out int response);
	[PreserveSig] int OnTypeChange(IFileDialog dlg);
	[PreserveSig] int OnOverwrite(IFileDialog dlg, IShellItem item, out int response);
}

// After Show() returns, GetFolder() gives back the folder passed to SetFolder()
// rather than the one browsed to, so the folder is tracked while the dialog is open.
class FolderTracker : IFileDialogEvents {
	public string Folder = "";
	public int OnFileOk(IFileDialog dlg) { return 0; }
	public int OnFolderChanging(IFileDialog dlg, IShellItem folder) { return 0; }
	public int OnFolderChange(IFileDialog dlg) {
		IShellItem item;
		if (dlg.GetFolder(out item) == 0) {
			string p = FileDialogHelper.PathOf(item);
			if (p.Length > 0) Folder = p;
		}
		return 0;
	}
	public int OnSelectionChange(IFileDialog dlg) { return 0; }
	public int OnShareViolation(IFileDialog dlg, IShellItem item, out int response) { response = 0; return unchecked((int) 0x80004001); }
	public int OnTypeChange(IFileDialog dlg) { return 0; }
	public int OnOverwrite(IFileDialog dlg, IShellItem item, out int response) { response = 0; return unchecked((int) 0x80004001); }
}

[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
	void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
	void GetParent(out IShellItem item);
	[PreserveSig] int GetDisplayName(uint sigdn, out IntPtr name);
	void GetAttributes(uint mask, out uint attribs);
	void Compare(IShellItem other, uint hint, out int order);
}

static class FileDialogHelper {
	const uint FOS_OVERWRITEPROMPT = 0x2, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800, FOS_FILEMUSTEXIST = 0x1000;
	const uint SIGDN_FILESYSPATH = 0x80058000;

	[DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
	static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);

	public static string PathOf(IShellItem item) {
		if (item == null) return "";
		IntPtr p;
		if (item.GetDisplayName(SIGDN_FILESYSPATH, out p) != 0) return "";   // virtual folder (This PC...)
		string s = Marshal.PtrToStringUni(p);
		Marshal.FreeCoTaskMem(p);
		return s ?? "";
	}

	[STAThread]
	static int Main(string[] args) {
		if (args.Length < 5) return 2;
		bool save = args[0] == "save";
		IntPtr owner = IntPtr.Zero;
		long h;
		if (long.TryParse(args[1], out h)) owner = new IntPtr(h);
		string folder = args[2], name = args[3], resultFile = args[4];

		Type t = Type.GetTypeFromCLSID(save ? new Guid("C0B4E2F3-BA21-4773-8DBA-335EC946EB8B")
		                                    : new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7"));
		IFileDialog dlg = (IFileDialog) Activator.CreateInstance(t);
		uint opts;
		dlg.GetOptions(out opts);
		opts |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | (save ? FOS_OVERWRITEPROMPT : FOS_FILEMUSTEXIST);
		dlg.SetOptions(opts);
		if (folder.Length > 0 && Directory.Exists(folder)) {
			try {
				Guid iid = typeof(IShellItem).GUID;
				IShellItem item;
				SHCreateItemFromParsingName(folder, IntPtr.Zero, ref iid, out item);
				dlg.SetFolder(item);
			} catch (Exception) {}
		}
		if (name.Length > 0) dlg.SetFileName(name);

		FolderTracker tracker = new FolderTracker();
		uint cookie;
		dlg.Advise(tracker, out cookie);
		bool ok = dlg.Show(owner) == 0;
		dlg.Unadvise(cookie);
		string file = "";
		if (ok) {
			IShellItem result;
			dlg.GetResult(out result);
			file = PathOf(result);
		}
		string last = tracker.Folder;
		File.WriteAllText(resultFile, (ok ? "ok" : "cancel") + "\n" + file + "\n" + last + "\n", new UTF8Encoding(false));
		return 0;
	}
}
