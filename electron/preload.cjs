const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workflowDesktop", {
  saveWorkflow: (payload) => ipcRenderer.invoke("workflow:save", payload),
  openWorkflow: () => ipcRenderer.invoke("workflow:open"),
  exportPdf: (payload) => ipcRenderer.invoke("workflow:export-pdf", payload),
  setDirty: (value) => ipcRenderer.send("workflow:set-dirty", value),
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("workflow:menu-command", listener);
    return () => ipcRenderer.removeListener("workflow:menu-command", listener);
  },
});
