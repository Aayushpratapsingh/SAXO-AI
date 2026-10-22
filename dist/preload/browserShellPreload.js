"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('browserShell', {
    navigate: (value) => electron_1.ipcRenderer.invoke('browser-shell:navigate', value),
    history: (action) => electron_1.ipcRenderer.invoke('browser-shell:history', action),
    close: () => electron_1.ipcRenderer.invoke('browser-shell:close'),
    onState: (callback) => {
        const listener = (_event, state) => callback(state);
        electron_1.ipcRenderer.on('browser-shell:state', listener);
        return () => electron_1.ipcRenderer.removeListener('browser-shell:state', listener);
    }
});
window.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('#address');
    const form = document.querySelector('#address-form');
    const tabsElement = document.querySelector('#tabs');
    const loading = document.querySelector('#loading');
    form?.addEventListener('submit', event => {
        event.preventDefault();
        if (input?.value.trim())
            void electron_1.ipcRenderer.invoke('browser-shell:navigate', input.value);
    });
    document.querySelector('#back')?.addEventListener('click', () => void electron_1.ipcRenderer.invoke('browser-shell:history', 'back'));
    document.querySelector('#forward')?.addEventListener('click', () => void electron_1.ipcRenderer.invoke('browser-shell:history', 'forward'));
    document.querySelector('#reload')?.addEventListener('click', () => void electron_1.ipcRenderer.invoke('browser-shell:history', 'reload'));
    document.querySelector('#new-tab')?.addEventListener('click', () => void electron_1.ipcRenderer.invoke('browser-shell:new-tab'));
    electron_1.ipcRenderer.on('browser-shell:state', (_event, state) => {
        if (tabsElement) {
            tabsElement.replaceChildren();
            for (const tab of state.tabs) {
                const tabButton = document.createElement('button');
                tabButton.className = `tab${tab.id === state.activeTabId ? ' active' : ''}`;
                tabButton.type = 'button';
                tabButton.title = tab.url || 'New tab';
                const favicon = document.createElement('span');
                favicon.className = 'favicon';
                favicon.textContent = 'S';
                const tabTitle = document.createElement('span');
                tabTitle.className = 'tab-title';
                tabTitle.textContent = tab.title || (tab.url ? new URL(tab.url).hostname : 'New tab');
                const close = document.createElement('span');
                close.className = 'tab-close';
                close.setAttribute('role', 'button');
                close.setAttribute('aria-label', 'Close tab');
                close.title = 'Close tab';
                close.textContent = '×';
                close.addEventListener('click', event => { event.stopPropagation(); void electron_1.ipcRenderer.invoke('browser-shell:close-tab', tab.id); });
                tabButton.append(favicon, tabTitle, close);
                tabButton.addEventListener('click', () => void electron_1.ipcRenderer.invoke('browser-shell:select-tab', tab.id));
                tabsElement.append(tabButton);
            }
        }
        if (input && document.activeElement !== input)
            input.value = state.url;
        loading?.classList.toggle('active', state.loading);
        if (!state.loading) {
            loading?.classList.add('done');
            setTimeout(() => loading?.classList.remove('done'), 350);
        }
    });
});
