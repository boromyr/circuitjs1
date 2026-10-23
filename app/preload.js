const { ipcRenderer } = require('electron');
const fs = require('fs');

var lastSavedFilePath = null;

// the file of the current circuit, for Options > Reopen Last Circuit at Startup
window.getCurrentFile = function () { return lastSavedFilePath; }
window.setCurrentFile = function (path) { lastSavedFilePath = path; }
window.fileExists = function (path) { try { return fs.statSync(path).isFile(); } catch (e) { return false; } }

window.showSaveDialog = function (defaultPath) { return ipcRenderer.invoke('show-save-dialog', defaultPath); }

window.saveFile = function (file, data, encoding) {
  var path;
  if (!file)
    path = lastSavedFilePath;
  else {
    path = file.filePath.toString();
    lastSavedFilePath = path;
  }
  fs.writeFile(path, data, { encoding: encoding || 'utf8' }, function (err) { if (err) window.alert(err); });
}

function baseName(fileName) {
  var shortName = fileName.substring(fileName.lastIndexOf('/')+1);
  return shortName.substring(shortName.lastIndexOf("\\")+1);
}

// reads a circuit file and makes it the current and most recent file
function readCircuitFile(fileName, callback, onError) {
  fs.readFile(fileName, 'utf-8', function (err, data) {
    if (err) { window.alert(err); if (onError) onError(); return; }
    lastSavedFilePath = fileName;
    ipcRenderer.send('add-recent-file', fileName);
    callback(data, baseName(fileName));
  });
}

window.openFile = function (callback) {
  ipcRenderer.invoke('show-open-dialog').then(function(result) {
    if (!result || result.canceled || result.filePaths.length == 0) return;
    readCircuitFile(result.filePaths[0], callback);
  });
}

// recent files (File > Open Recent), most recent first, kept by main.js
window.getRecentFiles = function () {
  return ipcRenderer.sendSync('get-recent-files');
}

// a file that cannot be read any more is dropped from the list
window.openRecentFile = function (fileName, callback) {
  readCircuitFile(fileName, callback, function () { ipcRenderer.send('remove-recent-file', fileName); });
}

window.toggleDevTools = function () {
  ipcRenderer.send('toggle-dev-tools');
}

// brings the open Bode or FFT window (frame name) to the front, see main.js
window.showPlotWindow = function (name) {
  ipcRenderer.send('show-plot-window', name);
}

window.newWindow = function () {
  ipcRenderer.send('new-window');
}

// File to open is passed as ?openFile=... URL param by main.js
// (from open-file event on Mac, or argv[1] on Windows/Linux)
const urlParams = new URLSearchParams(window.location.search);
const fileToOpen = urlParams.get('openFile');
if (fileToOpen) {
  var arg1 = fileToOpen;
  window.startCircuitFileName = baseName(arg1);
  try {
    window.startCircuitText = fs.readFileSync(fileToOpen, 'utf-8');
    lastSavedFilePath = arg1;
    ipcRenderer.send('add-recent-file', arg1);
  } catch(err) {
    window.alert(err);
  }
}
