const electron = require('electron')
// Module to control application life.
const app = electron.app
// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow
const Menu = electron.Menu
const ipcMain = electron.ipcMain
const dialog = electron.dialog

const path = require('path')
const url = require('url')
const fs = require('fs')


// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var windows = [];

// Build a minimal application menu so that standard keyboard shortcuts
// (Cmd+C, Cmd+V, Cmd+X, Cmd+A) work in text fields on macOS.
// Setting the menu to false disables these shortcuts entirely.
var template = [
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  }
];
if (process.platform === 'darwin') {
  template.unshift({
    label: app.getName(),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
} else {
  Menu.setApplicationMenu(null);
}


var pendingOpenFile = null;
var argvConsumed = false;

// Find the file path in an argv array, skipping flags (args starting with '-')
function getFileFromArgv(argv) {
  for (var i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('-'))
      return argv[i];
  }
  return null;
}

// Parse --key=value or --key value flags from argv into an object
function getParamsFromArgv(argv) {
  var params = {};
  var allowed = ['startCircuit','startLabel','startCircuitLink','positiveColor','negativeColor',
                 'neutralColor','selectColor','currentColor','mouseMode','running'];
  for (var i = 1; i < argv.length; i++) {
    var arg = argv[i];
    if (!arg.startsWith('--')) continue;
    var eq = arg.indexOf('=');
    var key, val;
    if (eq >= 0) {
      key = arg.substring(2, eq);
      val = arg.substring(eq + 1);
    } else if (i + 1 < argv.length && !argv[i+1].startsWith('-')) {
      key = arg.substring(2);
      val = argv[++i];
    } else {
      key = arg.substring(2);
      val = 'true';
    }
    if (allowed.indexOf(key) >= 0)
      params[key] = val;
  }
  return params;
}

// Extra URL params parsed once from process.argv at startup
var extraParams = getParamsFromArgv(process.argv);

if (process.argv.indexOf('--help') >= 0) {
  console.log(
    'Usage: CircuitJS1 [options] [file.cir]\n' +
    '\n' +
    'Options:\n' +
    '  --help                   Show this help message\n' +
    '  --startCircuit=URL       Load circuit from URL\n' +
    '  --startLabel=LABEL       Label for the circuit\n' +
    '  --startCircuitLink=URL   Load circuit from Dropbox link\n' +
    '  --running=false          Start with simulation paused\n' +
    '  --mouseMode=MODE         Initial mouse mode\n' +
    '  --positiveColor=COLOR    Color for positive voltage\n' +
    '  --negativeColor=COLOR    Color for negative voltage\n' +
    '  --neutralColor=COLOR     Color for neutral/ground\n' +
    '  --selectColor=COLOR      Color for selected elements\n' +
    '  --currentColor=COLOR     Color for current flow\n'
  );
  process.exit(0);
}

// On Windows, if a second instance is launched (e.g. double-clicking another
// associated file), send its argv to this instance and quit immediately.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (process.platform !== 'darwin') {
      var f = getFileFromArgv(argv);
      if (f) {
        pendingOpenFile = f;
        createWindow();
      }
    }
  });
}

app.on('open-file', function(event, filePath) {
event.preventDefault();
  pendingOpenFile = filePath;
  if (app.isReady()) {
    createWindow();
  }
});

// The open and save dialogs start in the last folder used by either of them,
// kept in the profile (userData) so it survives restarts.
function lastDirFile() {
  return path.join(app.getPath('userData'), 'last-dir.json');
}

function getLastDir() {
  try {
    var dir = JSON.parse(fs.readFileSync(lastDirFile(), 'utf8')).dir;
    if (dir && fs.statSync(dir).isDirectory())
      return dir;
  } catch (e) {}
  return null;
}

function setLastDir(dir) {
  if (!dir)
    return;
  try {
    fs.writeFileSync(lastDirFile(), JSON.stringify({ dir: dir }));
  } catch (e) {}
}

// Electron's dialogs lose the folder the user browsed to when they are closed
// without a file.  On Windows the dialogs go through filedialog.exe (built by
// build.bat from filedialog.cs), which reports that folder too; without it
// (or elsewhere) Electron's own dialogs are used and only a chosen file counts.
var FILEDIALOG = path.join(__dirname, 'filedialog.exe');

// resolves to {ok, file, folder}, or null when the helper is not available
function nativeDialog(win, mode, folder, name) {
  if (process.platform !== 'win32' || !fs.existsSync(FILEDIALOG))
    return Promise.resolve(null);
  var hwnd = win ? win.getNativeWindowHandle() : null;
  var owner = hwnd ? (hwnd.length >= 8 ? hwnd.readBigUInt64LE(0) : hwnd.readUInt32LE(0)).toString() : '';
  var out = path.join(require('os').tmpdir(), 'circuitjs-dialog-' + process.pid + '-' + Date.now() + '.txt');
  return new Promise(function (resolve) {
    require('child_process').execFile(FILEDIALOG, [mode, owner, folder || '', name || '', out], function (err) {
      var lines = null;
      try { lines = fs.readFileSync(out, 'utf8').split('\n'); fs.unlinkSync(out); } catch (e) {}
      if (err || !lines)
        resolve(null);
      else
        resolve({ ok: lines[0] === 'ok' && !!lines[1], file: lines[1], folder: lines[2] });
    });
  });
}

ipcMain.handle('show-save-dialog', async (event, defaultPath) => {
  var win = BrowserWindow.fromWebContents(event.sender);
  var dir = getLastDir();
  var name = defaultPath ? path.basename(defaultPath) : '';
  var start = (defaultPath && path.isAbsolute(defaultPath)) ? path.dirname(defaultPath) : dir;
  var r = await nativeDialog(win, 'save', start, name);
  if (r) {
    setLastDir(r.ok ? path.dirname(r.file) : r.folder);
    return { canceled: !r.ok, filePath: r.ok ? r.file : undefined };
  }
  var opts = {};
  // a bare file name goes into the last folder; a full path is kept as it is
  if (defaultPath)
    opts.defaultPath = (dir && !path.isAbsolute(defaultPath)) ? path.join(dir, defaultPath) : defaultPath;
  else if (dir)
    opts.defaultPath = dir;
  var result = await dialog.showSaveDialog(win, opts);
  if (!result.canceled && result.filePath)
    setLastDir(path.dirname(result.filePath));
  return result;
});

ipcMain.handle('show-open-dialog', async (event) => {
  var win = BrowserWindow.fromWebContents(event.sender);
  var dir = getLastDir();
  var r = await nativeDialog(win, 'open', dir, '');
  if (r) {
    setLastDir(r.ok ? path.dirname(r.file) : r.folder);
    return { canceled: !r.ok, filePaths: r.ok ? [r.file] : [] };
  }
  var opts = { properties: ['openFile'] };
  if (dir)
    opts.defaultPath = dir;
  var result = await dialog.showOpenDialog(win, opts);
  if (!result.canceled && result.filePaths.length > 0)
    setLastDir(path.dirname(result.filePaths[0]));
  return result;
});

ipcMain.on('toggle-dev-tools', (event) => {
  BrowserWindow.fromWebContents(event.sender).toggleDevTools();
});

// Bode and FFT windows of each simulator window, by frame name.  Opening one that is
// open already brings it to the front: window.focus() from the page cannot do that
// once the window is behind others.
const plotWindows = new Map();
ipcMain.on('show-plot-window', (event, name) => {
  const win = plotWindows.get(event.sender.id + ':' + name);
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
});

ipcMain.on('new-window', () => {
  createWindow();
});

// The last files opened, most recent first (File > Open Recent), kept in the
// profile and shared by all the windows.
var MAX_RECENT = 10;

function recentFilesFile() {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

function loadRecentFiles() {
  try {
    var list = JSON.parse(fs.readFileSync(recentFilesFile(), 'utf8'));
    if (Array.isArray(list))
      return list.filter(function (f) { return typeof f === 'string'; }).slice(0, MAX_RECENT);
  } catch (e) {}
  return [];
}

function saveRecentFiles(list) {
  try {
    fs.writeFileSync(recentFilesFile(), JSON.stringify(list, null, 1));
  } catch (e) {}
}

function sameFile(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

ipcMain.on('get-recent-files', (event) => {
  event.returnValue = loadRecentFiles();
});

ipcMain.on('add-recent-file', (event, file) => {
  if (typeof file !== 'string' || !file)
    return;
  file = path.resolve(file);
  var list = loadRecentFiles().filter(function (f) { return !sameFile(f, file); });
  list.unshift(file);
  saveRecentFiles(list.slice(0, MAX_RECENT));
});

ipcMain.on('remove-recent-file', (event, file) => {
  saveRecentFiles(loadRecentFiles().filter(function (f) { return !sameFile(f, file); }));
});

// only the first window may reopen the last circuit (Options > Reopen Last Circuit at Startup)
var firstWindowMade = false;

function createWindow () {
  // On Mac, use open-file event path; on Windows/Linux use argv[1]
  var fileToOpen = pendingOpenFile;
  pendingOpenFile = null;
  if (!fileToOpen && !argvConsumed && process.platform !== 'darwin') {
    fileToOpen = getFileFromArgv(process.argv);
    argvConsumed = true;
  }
// Create the browser window.
  var mainWindow = new BrowserWindow({width: 1200,
    height: 800,
    webPreferences: { nativeWindowOpen: true,
                      sandbox: false,
                      contextIsolation: false,
                      preload: path.join(__dirname, 'preload.js')
    }
  })
  windows.push(mainWindow);

  var loadUrl = url.format({
    pathname: path.join(__dirname, 'war/circuitjs.html'),
    protocol: 'file:',
    slashes: true
  });
  var queryParts = [];
  if (fileToOpen)
    queryParts.push('openFile=' + encodeURIComponent(fileToOpen));
  if (!firstWindowMade)
    queryParts.push('restoreLast=1');
  firstWindowMade = true;
  Object.keys(extraParams).forEach(function(k) {
    queryParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(extraParams[k]));
  });
  if (queryParts.length > 0)
    loadUrl += '?' + queryParts.join('&');
  mainWindow.loadURL(loadUrl);

  // Open the DevTools.
  //mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    var i = windows.indexOf(mainWindow);
    if (i >= 0)
      windows.splice(i, 1);
  })

  mainWindow.webContents.setWindowOpenHandler(({ frameName }) => {
	// Bode plot window (war/bodeplot.js): a blank, same-origin window that the simulator
	// page fills and redraws itself.  Not a child of the simulator window, so activating the
	// simulator brings it in front (the speed slider is in the plot windows too)
	if (frameName === 'circuitjs-bode') {
	  return { action: 'allow', overrideBrowserWindowOptions: {
	    title: 'Bode Plot',
	    minWidth: 480,
	    minHeight: 320,
	    backgroundColor: '#1e1e1e',
	    autoHideMenuBar: true
	  } };
	}
	// FFT window (war/fftplot.js), made the same way
	if (frameName === 'circuitjs-fft') {
	  return { action: 'allow', overrideBrowserWindowOptions: {
	    title: 'FFT',
	    minWidth: 560,
	    minHeight: 360,
	    backgroundColor: '#1e1e1e',
	    autoHideMenuBar: true
	  } };
	}
	// new windows are handled via IPC (window.newWindow); deny everything else
	return { action: 'deny' };
  });
  mainWindow.webContents.on('did-create-window', (win, details) => {
	if (details.frameName === 'circuitjs-bode' || details.frameName === 'circuitjs-fft') {
	  const key = mainWindow.webContents.id + ':' + details.frameName;
	  plotWindows.set(key, win);
	  win.on('closed', () => { if (plotWindows.get(key) === win) plotWindows.delete(key); });
	}
  });

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// The page is loaded from file://, where a service worker can't fetch()
// anything, so a worker registered by an earlier build (cached under the
// web version's file names) would fail every load, including circuitjs.html
// itself.  Clear any such worker and its caches before opening a window.
app.on('ready', function () {
  electron.session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
    .catch(function (err) { console.error('Failed to clear service workers:', err); })
    .then(createWindow);
})

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (windows.length == 0) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
