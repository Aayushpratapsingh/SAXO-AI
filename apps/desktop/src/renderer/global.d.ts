interface Window {
  saxo: {
    version: string;
    propose: (payload: { taskId: string; action: { type: 'navigate'; url: string; reason: string } | { type: 'search-web'; query: string; site: string; reason: string } | { type: 'search-youtube'; query: string; reason: string } | { type: 'open-video'; url: string; title: string; reason: string } | { type: 'play-video'; url: string; title: string; reason: string } }) => Promise<{ actionId: string; approvalToken: string; action: unknown; expiresAt: number }>;
    approve: (payload: { taskId: string; actionId: string; approvalToken: string }) => Promise<{ ok: boolean; result?: { url: string; title: string; status: number | null; video?: { url: string; title: string; thumbnail?:string }; playing?: boolean }; error?: string }>;
    reject: (actionId: string) => Promise<{ rejected: boolean }>;
    browserStatus: () => Promise<{ connected: boolean; url: string | null }>;
    firstYouTubeVideo: () => Promise<{ url: string; title: string; thumbnail?:string }>;
    chat: (payload: { messages: Array<{ role: 'user'|'assistant'; content: string }> }) => Promise<{ text: string }>;
    voiceStatus: () => Promise<{ configured: boolean; envFileFound: boolean; model: string }>;
    sendVoiceMessage: (payload: { audioBase64: string; mimeType: string }) => Promise<{ messageId: string; mimeType: string; bytes: number }>;
    readVoiceMessage: (payload: { messageId: string; mimeType: string }) => Promise<{ audioBase64: string }>;
    transcribeAudio: (payload: { messageId: string; mimeType: string }) => Promise<{ text: string }>;
  };
}
