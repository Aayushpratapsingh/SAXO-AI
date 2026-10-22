import { contextBridge, ipcRenderer } from 'electron';

export type ProposedAction =
  | { type: 'navigate'; url: string; reason: string }
  | { type: 'search-web'; query: string; site: string; reason: string }
  | { type: 'search-youtube'; query: string; reason: string }
  | { type: 'open-video'; url: string; title: string; reason: string }
  | { type: 'play-video'; url: string; title: string; reason: string };
contextBridge.exposeInMainWorld('saxo', {
  version: '0.2.0',
  propose: (payload: { taskId: string; action: ProposedAction }) => ipcRenderer.invoke('action:propose', payload),
  approve: (payload: { taskId: string; actionId: string; approvalToken: string }) => ipcRenderer.invoke('action:approve', payload),
  reject: (actionId: string) => ipcRenderer.invoke('action:reject', { actionId }),
  browserStatus: () => ipcRenderer.invoke('browser:status'),
  firstYouTubeVideo: () => ipcRenderer.invoke('browser:first-youtube-video'),
  chat: (payload: { messages: Array<{ role: 'user'|'assistant'; content: string }> }) => ipcRenderer.invoke('chat:reply', payload),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  sendVoiceMessage: (payload: { audioBase64: string; mimeType: string }) => ipcRenderer.invoke('voice:send', payload),
  readVoiceMessage: (payload: { messageId: string; mimeType: string }) => ipcRenderer.invoke('voice:read', payload),
  transcribeAudio: (payload: { messageId: string; mimeType: string }) => ipcRenderer.invoke('voice:transcribe', payload)
});
