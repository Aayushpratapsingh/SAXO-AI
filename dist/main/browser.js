"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.navigateApproved = navigateApproved;
exports.searchWebApproved = searchWebApproved;
exports.searchYouTubeApproved = searchYouTubeApproved;
exports.firstYouTubeVideo = firstYouTubeVideo;
exports.openYouTubeVideoApproved = openYouTubeVideoApproved;
exports.playYouTubeVideoApproved = playYouTubeVideoApproved;
exports.browserState = browserState;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const youtubeOrigin = /^https:\/\/(?:www\.)?youtube\.com\//i;
let chromeWindowId = null;
async function runJxa(source, timeout = 25_000) {
    if (process.platform !== 'darwin')
        throw new Error('SAXO’s Chrome connection currently requires macOS.');
    try {
        const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', source], { timeout, maxBuffer: 1_000_000, encoding: 'utf8' });
        return stdout.trim();
    }
    catch (error) {
        const details = error;
        const diagnostic = [details.stderr, details.stdout].filter(Boolean).join('\n').trim();
        const message = [error instanceof Error ? error.message : String(error), diagnostic].filter(Boolean).join('\n');
        if (/not authorized|not permitted|(-1743)|assistive access/i.test(message)) {
            throw new Error('Allow SAXO AI to control Google Chrome in System Settings → Privacy & Security → Automation, then retry.');
        }
        if (/javascript.*not allowed|not allowed.*javascript|(-1708)|execute javascript/i.test(message)) {
            throw new Error('In Chrome, enable View → Developer → Allow JavaScript from Apple Events, then retry the approved action.');
        }
        if (/Chrome has no windows/i.test(message))
            throw new Error('Open a Chrome window, then retry.');
        throw new Error(`Chrome action failed: ${diagnostic || message.split('\n')[0]}`);
    }
}
async function runChromeScript(script, timeout = 25_000) {
    const source = `var app = Application("/Applications/Google Chrome.app"); if (!app.running()) throw new Error("Open a Chrome window first."); var windows = app.windows(); var window = windows.filter(item => String(item.id()) === ${JSON.stringify(String(chromeWindowId ?? -1))})[0]; if (!window) throw new Error("The SAXO Chrome window is no longer available. Ask SAXO to open a page to connect again."); var tab = window.activeTab(); var result = tab.execute({javascript: ${JSON.stringify(script)}}); result === undefined || result === null ? "" : String(result);`;
    return runJxa(source, timeout);
}
async function ensureChromeWindow() {
    const check = (id) => runJxa(`var app = Application("/Applications/Google Chrome.app"); app.running() && app.windows().some(item => String(item.id()) === ${JSON.stringify(String(id))}) ? "yes" : "no"`, 5000);
    if (chromeWindowId !== null && await check(chromeWindowId) === 'yes')
        return chromeWindowId;
    chromeWindowId = null;
    const before = await runJxa(`var app = Application("/Applications/Google Chrome.app"); if (!app.running()) ""; else app.windows().map(item => String(item.id())).join(",");`, 5000).catch(() => '');
    const previousIds = new Set(before.split(',').filter(Boolean));
    try {
        await execFileAsync('/usr/bin/open', ['-a', '/Applications/Google Chrome.app', '--args', '--new-window'], { timeout: 10_000 });
    }
    catch (error) {
        throw new Error(`Could not open a regular Chrome window: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (let attempt = 0; attempt < 30; attempt++) {
        const created = await runJxa(`var app = Application("/Applications/Google Chrome.app"); if (!app.running()) ""; else app.windows().map(item => String(item.id())).join(",");`, 5000).catch(() => '');
        const newId = created.split(',').find(id => id && !previousIds.has(id));
        if (newId) {
            chromeWindowId = Number(newId);
            return chromeWindowId;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Chrome did not create a new regular-profile window. Open Chrome normally, then retry the approved action.');
}
async function chromeState() {
    if (chromeWindowId === null)
        return '';
    const source = `var app = Application("/Applications/Google Chrome.app"); if (!app.running()) ""; else { var windows = app.windows(); var window = windows.filter(item => String(item.id()) === ${JSON.stringify(String(chromeWindowId))})[0]; window ? window.activeTab().url() + "\\n" + window.activeTab().title() : ""; }`;
    return runJxa(source, 5000);
}
async function navigateChrome(url) {
    const targetWindowId = await ensureChromeWindow();
    const source = `var app = Application("/Applications/Google Chrome.app"); var windows = app.windows(); var window = windows.filter(item => String(item.id()) === ${JSON.stringify(String(targetWindowId))})[0]; if (!window) throw new Error("SAXO Chrome window is unavailable (wanted ${targetWindowId}; found " + windows.map(item => String(item.id())).join(",") + ")"); var tab = window.activeTab(); tab.url = ${JSON.stringify(url)}; for (var i = 0; i < 80 && tab.loading(); i++) delay(0.25); tab.url() + "\\n" + tab.title();`;
    const output = await runJxa(source, 30_000);
    const [actualUrl, ...titleParts] = output.split('\n');
    if (!actualUrl || !/^https?:\/\//i.test(actualUrl))
        throw new Error('Chrome did not finish opening the approved page.');
    return { url: actualUrl, title: titleParts.join('\n').trim() || 'Untitled page', status: 200 };
}
async function waitForChromeScript(script, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await runChromeScript(script).catch(error => { throw error; });
        if (result && result !== 'null' && result !== 'false')
            return result;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('Chrome did not finish loading the page in time.');
}
const firstVideoScript = `JSON.stringify((() => {
  const links = [...document.querySelectorAll('ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title-link')];
  const link = links.find(item => item.href && item.getClientRects().length);
  if (!link) return null;
  const title = (link.getAttribute('title') || link.textContent || '').trim();
  const item = link.closest('ytd-video-renderer, ytd-rich-item-renderer');
  const image = item?.querySelector('img');
  return title ? { title, url: link.href, thumbnail: image?.currentSrc || image?.src || '' } : null;
})())`;
async function readFirstVideo() {
    const result = await waitForChromeScript(firstVideoScript, 15_000);
    let video;
    try {
        video = JSON.parse(result);
    }
    catch {
        video = null;
    }
    if (!video?.title || !video?.url)
        throw new Error('No first video is available on the current YouTube page.');
    return video;
}
async function navigateApproved(url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only web addresses can be opened in Chrome.');
    return navigateChrome(parsed.toString());
}
async function searchWebApproved(query, site) {
    const encoded = encodeURIComponent(query);
    const destination = site === 'github.com' ? `https://github.com/search?q=${encoded}`
        : site === 'reddit.com' ? `https://www.reddit.com/search/?q=${encoded}`
            : site ? `https://www.google.com/search?q=${encoded}+site%3A${encodeURIComponent(site)}`
                : `https://www.google.com/search?q=${encoded}`;
    return navigateChrome(destination);
}
async function searchYouTubeApproved(query) {
    const currentUrl = await runJxa(`var app = Application("/Applications/Google Chrome.app"); if (!app.running()) throw new Error("Open YouTube in SAXO Chrome first."); var windows = app.windows(); var window = windows.filter(item => String(item.id()) === ${JSON.stringify(String(chromeWindowId ?? -1))})[0]; if (!window) throw new Error("Open YouTube in SAXO Chrome first."); window.activeTab().url();`);
    if (!youtubeOrigin.test(currentUrl))
        throw new Error('Open YouTube in the SAXO Chrome tab before searching there.');
    await navigateChrome(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    const video = await readFirstVideo();
    const page = await browserState();
    return { url: page.url || currentUrl, title: page.title || 'YouTube search results', status: 200, video };
}
async function firstYouTubeVideo() {
    const page = await browserState();
    if (!page.url || !youtubeOrigin.test(page.url))
        throw new Error('Open YouTube in the SAXO Chrome tab before selecting a video.');
    return readFirstVideo();
}
async function openYouTubeVideoApproved(url) {
    if (!/^https:\/\/(?:www\.)?youtube\.com\/watch\?/i.test(url))
        throw new Error('The selected result is not a YouTube video.');
    await navigateChrome(url);
    await waitForChromeScript("JSON.stringify(Boolean(document.querySelector('video')))", 20_000);
    const page = await browserState();
    const playing = await runChromeScript("JSON.stringify((() => { const video=document.querySelector('video'); return Boolean(video && !video.paused && !video.ended); })())");
    return { url: page.url || url, title: page.title || 'YouTube video', status: 200, playing: playing === 'true' };
}
async function playYouTubeVideoApproved(url) {
    const page = await browserState();
    const approvedId = new URL(url).searchParams.get('v');
    const currentId = page.url ? new URL(page.url).searchParams.get('v') : null;
    if (!approvedId || currentId !== approvedId)
        throw new Error('The approved YouTube video is no longer in the active Chrome tab.');
    const result = await runChromeScript("JSON.stringify((async () => { const video=document.querySelector('video'); if(!video)return false; try { await video.play(); } catch {} return Boolean(!video.paused && !video.ended); })())");
    if (result !== 'true')
        throw new Error('Chrome did not start playback. Click Play in YouTube, then ask SAXO to verify again.');
    const updated = await browserState();
    return { url: updated.url || url, title: updated.title || 'YouTube video', status: 200, playing: true };
}
async function browserState() {
    try {
        const output = await chromeState();
        const [url, ...titleParts] = output.split('\n');
        return { connected: Boolean(url), url: url || null, title: titleParts.join('\n').trim() || null };
    }
    catch {
        return { connected: false, url: null, title: null };
    }
}
