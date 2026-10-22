import { app, BrowserWindow, ipcMain, screen, session, systemPreferences } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPendingAction, consumeApproval, rejectAction } from './approval';
import { browserState, firstYouTubeVideo, navigateApproved, openYouTubeVideoApproved, playYouTubeVideoApproved, searchYouTubeApproved, searchWebApproved } from './browser';

let mainWindow: BrowserWindow | undefined;
let envFileFound = false;
function loadLocalEnv() {
  const appPath = app.getAppPath();
  const envPaths = [path.join(appPath, '.env'), path.join(app.getPath('userData'), '.env')];
  // A locally packaged app lives under <project>/release; read the project-level
  // .env without copying the secret into the packaged application.
  const releaseSegment = `${path.sep}release${path.sep}`;
  const releaseIndex = appPath.indexOf(releaseSegment);
  if (releaseIndex > 0) envPaths.unshift(path.join(appPath.slice(0, releaseIndex), '.env'));
  for (const envPath of envPaths) {
    try {
      const envFile = fs.readFileSync(envPath, 'utf8');
    envFileFound = true;
    for (const line of envFile.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
      if (process.env.GROQ_API_KEY?.trim()) return;
    } catch { /* Local env file is optional. */ }
  }
}
const assertRenderer = (event: Electron.IpcMainInvokeEvent) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted IPC sender.');
};

ipcMain.handle('action:propose', (event, input: unknown) => {
  assertRenderer(event);
  if (!input || typeof input !== 'object' || typeof (input as { taskId?: unknown }).taskId !== 'string') throw new Error('A task identifier is required.');
  const { taskId, action } = input as { taskId: string; action: unknown };
  return createPendingAction(taskId, action);
});
ipcMain.handle('action:approve', async (event, payload: unknown) => {
  assertRenderer(event);
  if (!payload || typeof payload !== 'object') throw new Error('Approval is missing.');
  const value = payload as Record<string, unknown>;
  try {
    const action = consumeApproval(value.taskId, value.actionId, value.approvalToken);
    const result = action.type === 'navigate'
      ? await navigateApproved(action.url)
      : action.type === 'search-web'
        ? await searchWebApproved(action.query, action.site)
      : action.type === 'search-youtube'
        ? await searchYouTubeApproved(action.query)
        : action.type === 'open-video'
          ? await openYouTubeVideoApproved(action.url)
          : await playYouTubeVideoApproved(action.url);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Browser navigation failed.' };
  }
});
ipcMain.handle('action:reject', (event, payload: unknown) => {
  assertRenderer(event);
  const id = payload && typeof payload === 'object' ? (payload as { actionId?: unknown }).actionId : undefined;
  return { rejected: rejectAction(id) };
});
ipcMain.handle('browser:status', event => { assertRenderer(event); return browserState(); });
ipcMain.handle('browser:first-youtube-video', event => { assertRenderer(event); return firstYouTubeVideo(); });
ipcMain.handle('voice:status', event => {
  assertRenderer(event);
  return { configured: Boolean(process.env.GROQ_API_KEY?.trim()), envFileFound, model: process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo' };
});
ipcMain.handle('voice:send', async (event, payload: unknown) => {
  assertRenderer(event);
  if (!payload || typeof payload !== 'object') throw new Error('Voice message is missing.');
  const { audioBase64, mimeType } = payload as { audioBase64?: unknown; mimeType?: unknown };
  if (typeof audioBase64 !== 'string' || typeof mimeType !== 'string' || audioBase64.length > 32_000_000) throw new Error('Voice message is invalid or too large.');
  const normalizedMime = mimeType.split(';')[0].toLowerCase();
  const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3' };
  const extension = extensions[normalizedMime];
  if (!extension) throw new Error('This recording format is not supported.');
  const bytes = Buffer.from(audioBase64, 'base64');
  if (!bytes.length || bytes.length > 24_000_000) throw new Error('Recording is empty or too large.');
  const messageId = randomUUID();
  const directory = path.join(app.getPath('userData'), 'voice-messages');
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(path.join(directory, `${messageId}.${extension}`), bytes, { mode: 0o600, flag: 'wx' });
  return { messageId, mimeType: normalizedMime, bytes: bytes.length };
});
ipcMain.handle('voice:read', async (event, payload: unknown) => {
  assertRenderer(event);
  if (!payload || typeof payload !== 'object') throw new Error('Voice message is missing.');
  const { messageId, mimeType } = payload as { messageId?: unknown; mimeType?: unknown };
  const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3' };
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/.test(messageId) || typeof mimeType !== 'string' || !extensions[mimeType]) throw new Error('Saved voice message is invalid.');
  try {
    const bytes = await fs.promises.readFile(path.join(app.getPath('userData'), 'voice-messages', `${messageId}.${extensions[mimeType]}`));
    if (!bytes.length || bytes.length > 24_000_000) throw new Error('Saved voice message is empty or too large.');
    return { audioBase64: bytes.toString('base64') };
  } catch { throw new Error('The saved voice message audio is unavailable.'); }
});
ipcMain.handle('chat:reply', async (event, payload: unknown) => {
  assertRenderer(event);
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { messages?: unknown }).messages)) throw new Error('Chat messages are missing.');
  const rawMessages = (payload as { messages: unknown[] }).messages;
  if (rawMessages.length < 1 || rawMessages.length > 12) throw new Error('Keep a conversation to the latest 12 messages.');
  let totalCharacters = 0;
  const messages = rawMessages.map(item => {
    if (!item || typeof item !== 'object') throw new Error('A chat message is invalid.');
    const message = item as Record<string, unknown>;
    if (!['user', 'assistant'].includes(String(message.role)) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) throw new Error('A chat message is invalid or too long.');
    totalCharacters += message.content.length;
    return { role: message.role as 'user'|'assistant', content: message.content.trim() };
  });
  if (totalCharacters > 16_000) throw new Error('This conversation is too long. Start a new chat to continue.');
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('Add GROQ_API_KEY to the project .env file to enable chat responses.');
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b',
        messages: [
        { role: 'system', content: 'You are SAXO, a friendly personal AI assistant. Respond naturally to everyday conversation, greetings, and general questions. Write in a polished, professional, easy-to-scan style: lead with the useful answer, keep paragraphs short, and use brief headings or bullets only when they improve clarity. Avoid filler, repeated greetings, dense walls of text, and unnecessary markdown. Use fenced code blocks only for code. You cannot browse the web or control apps from chat. Never claim you performed an action. For browser tasks, explain that SAXO will show a separate action for the user to approve.' },
          ...messages
        ],
        temperature: 0.7,
        max_completion_tokens: 700
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('SAXO took too long to respond. Try again.');
    throw new Error('Could not reach Groq. Check your internet connection and try again.');
  }
  let result: { choices?: Array<{ message?: { content?: string | null } }>; error?: { message?: string } };
  try { result = await response.json() as typeof result; }
  catch { throw new Error(`Groq returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(result.error?.message || `Chat response failed (${response.status}).`);
  const reply = result.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('SAXO did not receive a response. Try again.');
  return { text: reply };
});
ipcMain.handle('voice:transcribe', async (event, payload: unknown) => {
  assertRenderer(event);
  if (!payload || typeof payload !== 'object') throw new Error('Audio is missing.');
  const { messageId, mimeType } = payload as { messageId?: unknown; mimeType?: unknown };
  if (typeof messageId !== 'string' || !/^[0-9a-f-]{36}$/.test(messageId) || typeof mimeType !== 'string') throw new Error('Voice message is missing.');
  const allowed = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg']);
  const normalizedMime = mimeType.split(';')[0].toLowerCase();
  if (!allowed.has(normalizedMime)) throw new Error('This recording format is not supported.');
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('Add GROQ_API_KEY to the project .env file to transcribe voice messages.');
  const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3' };
  let bytes: Buffer;
  try { bytes = await fs.promises.readFile(path.join(app.getPath('userData'), 'voice-messages', `${messageId}.${extensions[normalizedMime]}`)); }
  catch { throw new Error('The saved voice message is unavailable.'); }
  if (!bytes.length || bytes.length > 24_000_000) throw new Error('Recording is empty or too large.');
  const extension = extensions[normalizedMime];
  const form = new FormData();
  const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append('file', new Blob([audioBuffer], { type: normalizedMime }), `voice.${extension}`);
  form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  let response: Response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(90_000)
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Groq transcription timed out. Try a shorter recording.');
    throw new Error('Could not reach Groq. Check your internet connection and try again.');
  }
  let result: { text?: string; error?: { message?: string } };
  try { result = await response.json() as typeof result; }
  catch { throw new Error(`Groq returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(result.error?.message || `Transcription failed (${response.status}).`);
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No speech was detected. Try recording again.');
  return { text: result.text.trim() };
});

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    x: workArea.x + 24, y: workArea.y + 48,
    width: 460, height: Math.min(780, workArea.height - 64), minWidth: 460, maxWidth: 460, minHeight: 700, maxHeight: 780,
    resizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#0b0f17', title: 'SAXO AI',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow = window;
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer process ended:', details));
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer console:', message); });
  if (!app.isPackaged) void window.loadURL('http://127.0.0.1:5173');
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(() => {
  loadLocalEnv();
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    const origin = contents?.getURL() || '';
    return permission === 'media' && (origin.startsWith('http://127.0.0.1:5173') || origin.startsWith('file://'));
  });
  session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback) => {
    const origin = contents.getURL();
    const trusted = contents === mainWindow?.webContents && (origin.startsWith('http://127.0.0.1:5173') || origin.startsWith('file://'));
    if (permission !== 'media' || !trusted) return callback(false);
    if (process.platform === 'darwin') {
      try { return callback(await systemPreferences.askForMediaAccess('microphone')); }
      catch { return callback(false); }
    }
    callback(true);
  });
  createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
