"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAction = validateAction;
exports.createPendingAction = createPendingAction;
exports.consumeApproval = consumeApproval;
exports.rejectAction = rejectAction;
const node_crypto_1 = require("node:crypto");
const pending = new Map();
const hash = (value) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
function validateAction(input) {
    if (!input || typeof input !== 'object')
        throw new Error('Invalid action proposal.');
    const value = input;
    if (typeof value.reason !== 'string' || value.reason.length > 500)
        throw new Error('A short reason is required for each action.');
    if (value.type === 'navigate' && typeof value.url === 'string') {
        let parsed;
        try {
            parsed = new URL(value.url);
        }
        catch {
            throw new Error('The proposed URL is invalid.');
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            throw new Error('Only HTTP and HTTPS URLs are allowed.');
        if (value.url.length > 2048)
            throw new Error('Action parameters are too long.');
        return { type: 'navigate', url: parsed.toString(), reason: value.reason };
    }
    if (value.type === 'search-web' && typeof value.query === 'string' && value.query.trim() && value.query.length <= 300 && typeof value.site === 'string' && value.site.length <= 253) {
        const site = value.site.trim().toLowerCase();
        if (site && !/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(site))
            throw new Error('The search site is invalid.');
        return { type: 'search-web', query: value.query.trim(), site, reason: value.reason };
    }
    if (value.type === 'search-youtube' && typeof value.query === 'string' && value.query.trim() && value.query.length <= 150) {
        return { type: 'search-youtube', query: value.query.trim(), reason: value.reason };
    }
    if ((value.type === 'open-video' || value.type === 'play-video') && typeof value.url === 'string' && typeof value.title === 'string') {
        let parsed;
        try {
            parsed = new URL(value.url);
        }
        catch {
            throw new Error('The video URL is invalid.');
        }
        if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname) || parsed.pathname !== '/watch' || !parsed.searchParams.get('v'))
            throw new Error('Only a YouTube watch URL can be used for this action.');
        if (value.title.length > 300)
            throw new Error('Video title is too long.');
        if (value.type === 'open-video')
            return { type: 'open-video', url: parsed.toString(), title: value.title, reason: value.reason };
        return { type: 'play-video', url: parsed.toString(), title: value.title, reason: value.reason };
    }
    throw new Error('This browser action is not supported.');
}
function createPendingAction(taskId, input) {
    if (typeof taskId !== 'string' || taskId.length < 8 || taskId.length > 100)
        throw new Error('Invalid task identifier.');
    const action = validateAction(input);
    const id = (0, node_crypto_1.randomUUID)();
    const token = (0, node_crypto_1.randomUUID)();
    const actionHash = hash(action);
    pending.set(id, { id, taskId, token, hash: actionHash, action, expiresAt: Date.now() + 60_000, consumed: false });
    return { actionId: id, approvalToken: token, action, actionHash, expiresAt: Date.now() + 60_000 };
}
function consumeApproval(taskId, actionId, token) {
    if (typeof taskId !== 'string' || typeof actionId !== 'string' || typeof token !== 'string')
        throw new Error('Approval is missing or invalid.');
    const record = pending.get(actionId);
    if (!record || record.taskId !== taskId || record.consumed || record.expiresAt < Date.now() || record.token !== token || record.hash !== hash(record.action)) {
        pending.delete(actionId);
        throw new Error('Approval expired or no longer matches the proposed action.');
    }
    record.consumed = true;
    pending.delete(actionId);
    return record.action;
}
function rejectAction(actionId) {
    if (typeof actionId !== 'string')
        return false;
    return pending.delete(actionId);
}
