# SAXO AI

A local-first Electron desktop assistant with a compact branded chat, voice messages, and approval-gated browser actions.

## Features

- Everyday chat responses through Groq Chat Completions.
- Approved navigation and search actions run in a dedicated Google Chrome window using your regular Chrome profile. Follow-up searches reuse that tab; opening and playing a YouTube result each require separate approvals.
- Search support for Google, GitHub, Reddit, YouTube, and arbitrary user-provided URLs. Requests such as “Open GitHub and search for Python projects” are handled as separate open and search actions.
- Voice recording with microphone permission, preview, send/discard, stored original audio, playback in chat, and Groq multilingual transcription. Audio is sent only after pressing **Send voice message**. Transcription is shown separately and is not translated.
- The official SAXO mark appears beside assistant messages.
- Responsive compact layout, keyboard focus indicators, and reduced-motion support.

## Chrome connection

On macOS, SAXO opens a new Google Chrome window using Chrome's regular profile when you approve the first browser action. It records that window's ID and sends later approved navigation, searches, and YouTube actions to the same window. The window can use your existing Chrome sign-in, cookies, and extensions. Every browser action still requires approval.

The first browser action may prompt macOS to let SAXO control Google Chrome. YouTube result inspection and playback also require Chrome's **View → Developer → Allow JavaScript from Apple Events** setting. Keep the SAXO Chrome window open while using browser features. If it is closed, approve a new **open website** action to connect again. If an error says the Chrome window is unavailable, quit and reopen SAXO, then retry; the packaged app must be restarted after an update.

Because SAXO uses your regular Chrome profile, browser actions may use your existing signed-in sessions. SAXO conversation history is still stored locally by the app. This connector currently works only on macOS.

## Run locally

Requires Node.js and npm.

```sh
npm install
cp .env.example .env
# Add GROQ_API_KEY to .env
npm run dev
```

`GROQ_CHAT_MODEL` and `GROQ_TRANSCRIPTION_MODEL` can override the defaults. Secrets stay in the Electron main process. Restart SAXO after changing `.env`.

Voice recordings accepted by Send are stored under the app's `userData/voice-messages` directory with private file permissions. Groq's speech-to-text endpoint receives the audio for transcription. Chat requests receive the transcript as text; the audio is preserved locally as a voice-message attachment.

Build an unpacked macOS app:

```sh
npm run build
```

The unpacked app is written to `release/mac-arm64/SAXO AI.app` on Apple Silicon Macs. Fully quit an older running copy before opening the rebuilt app, so the new browser controller is loaded.

Run available unit tests:

```sh
npm test
```

## Security boundaries

- The renderer has no Node.js or filesystem access; it calls a narrow preload API.
- Browser actions are schema-validated, attached to a one-time approval token, and only dispatched after explicit approval.
- Website text is not sent to the chat model as executable instructions; the model cannot directly invoke browser control.
- Voice audio remains local until the user explicitly sends it. Transcription errors keep the saved voice message and expose a retry action.
