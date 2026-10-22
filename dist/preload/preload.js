"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('saxo', {
    version: '0.2.0',
    propose: (payload) => electron_1.ipcRenderer.invoke('action:propose', payload),
    approve: (payload) => electron_1.ipcRenderer.invoke('action:approve', payload),
    reject: (actionId) => electron_1.ipcRenderer.invoke('action:reject', { actionId }),
    browserStatus: () => electron_1.ipcRenderer.invoke('browser:status'),
    firstYouTubeVideo: () => electron_1.ipcRenderer.invoke('browser:first-youtube-video'),
    chat: (payload) => electron_1.ipcRenderer.invoke('chat:reply', payload),
    voiceStatus: () => electron_1.ipcRenderer.invoke('voice:status'),
    sendVoiceMessage: (payload) => electron_1.ipcRenderer.invoke('voice:send', payload),
    readVoiceMessage: (payload) => electron_1.ipcRenderer.invoke('voice:read', payload),
    transcribeAudio: (payload) => electron_1.ipcRenderer.invoke('voice:transcribe', payload)
});
