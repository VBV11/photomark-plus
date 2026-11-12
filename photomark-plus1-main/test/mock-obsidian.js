// A small stand-in for the parts of the Obsidian API that PhotoMark+ uses.
// Loaded by test/index.html so the plugin can run in a plain browser (see test/run.js).
// It is deliberately minimal and not a faithful copy of Obsidian.
(async () => {
  const params = new URLSearchParams(location.search);
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.setText = function (t) { this.textContent = t; };

  class TFile {
    constructor(path, mtime) {
      this.path = path;
      this.name = path.split('/').pop();
      this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
      this.basename = this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/';
      this.parent = { path: dir };
      this.stat = { mtime };
    }
  }

  // ---- vault contents ----
  const files = [new TFile('Attachments/sample.png', 1000), new TFile('Attachments/second.png', 1000), new TFile('Network setup.md', 1000), new TFile('Other.md', 1000)];
  const binaries = {};
  for (const p of ['Attachments/sample.png', 'Attachments/second.png']) binaries[p] = await (await fetch(`vault/${p}`)).arrayBuffer();
  const texts = {
    'Network setup.md': '# Network setup\n\nThe router dashboard after the change:\n\n![[Attachments/sample.png|500]]\n\nSame image as a markdown link: ![dashboard](Attachments/sample.png) and a second one ![[second.png]].\n',
    'Other.md': 'Nothing here.\n',
  };
  const embedsOf = (text) => {
    const out = [];
    const re = /!\[\[([^\]|#]+)(?:[^\]]*)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(text))) {
      let link = m[1] || m[2];
      try { link = decodeURIComponent(link); } catch (e) { /* keep */ }
      out.push({ link, original: m[0], position: { start: { offset: m.index }, end: { offset: m.index + m[0].length } } });
    }
    return out;
  };

  window.calls = { modifyBinary: [], createBinary: [], process: [], notices: [], commands: [], settingsSaved: [] };
  const handlers = {};
  const app = {
    vault: {
      getFiles: () => files.slice(),
      getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
      getResourcePath: (f) => new URL(`vault/${encodeURI(f.path)}?${f.stat.mtime}`, location.href).href,
      readBinary: async (f) => binaries[f.path],
      modifyBinary: async (f, buf) => { binaries[f.path] = buf; f.stat.mtime++; window.calls.modifyBinary.push({ path: f.path, bytes: buf.byteLength }); window.lastSaved = buf; },
      createBinary: async (path, buf) => { if (files.some((f) => f.path === path)) throw new Error('exists'); const f = new TFile(path, 2000); files.push(f); binaries[path] = buf; window.calls.createBinary.push({ path, bytes: buf.byteLength }); window.lastSaved = buf; return f; },
      process: async (f, fn) => { texts[f.path] = fn(texts[f.path]); window.calls.process.push(f.path); return texts[f.path]; },
      read: async (f) => texts[f.path],
    },
    metadataCache: {
      getFirstLinkpathDest: (link, source) => files.find((f) => f.path === link) || files.find((f) => f.name === link || f.basename === link) || null,
      getFileCache: (f) => (texts[f.path] != null ? { embeds: embedsOf(texts[f.path]) } : null),
    },
    workspace: {
      on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return { name, fn }; },
      iterateAllLeaves: (cb) => cb({ view: { containerEl: document.querySelector('.workspace-leaf-content'), getViewType: () => 'markdown', file: files[2] } }),
      getActiveFile: () => window.activeFile || files[2],
      getMostRecentLeaf: () => ({ view: { getViewType: () => 'markdown', file: files[2] } }),
      activeEditor: { editor: { getLine: () => window.cursorLine || '', getCursor: () => ({ line: 0 }) } },
    },
  };

  // ---- UI classes ----
  const modalStack = [];
  class Scope {
    constructor() { this.keys = []; }
    register(mods, key, fn) { this.keys.push({ mods: mods || [], key, fn }); }
    handle(e) {
      for (const k of this.keys) {
        const wantMod = k.mods.includes('Mod');
        if (wantMod !== (e.ctrlKey || e.metaKey)) continue;
        const same = k.key.length === 1 ? e.key.toUpperCase() === k.key.toUpperCase() : e.key === k.key;
        if (!same) continue;
        if (k.fn(e) === false) e.preventDefault();
        return true;
      }
      return false;
    }
  }
  document.addEventListener('keydown', (e) => {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') { e.preventDefault(); top.close(); return; }
    top.scope.handle(e);
  });
  class Modal {
    constructor(a) {
      this.app = a;
      this.scope = new Scope();
      const d = (c) => Object.assign(document.createElement('div'), { className: c });
      this.containerEl = d('modal-container mod-dim');
      const bg = d('modal-bg');
      this.modalEl = d('modal');
      const x = d('modal-close-button');
      this.titleEl = d('modal-title');
      this.contentEl = d('modal-content');
      this.modalEl.append(x, this.titleEl, this.contentEl);
      this.containerEl.append(bg, this.modalEl);
      bg.addEventListener('click', () => this.close());
      x.addEventListener('click', () => this.close());
    }
    open() { document.body.append(this.containerEl); modalStack.push(this); this.onOpen && this.onOpen(); }
    close() { const i = modalStack.indexOf(this); if (i >= 0) modalStack.splice(i, 1); this.containerEl.remove(); this.onClose && this.onClose(); }
  }
  class FuzzySuggestModal extends Modal {
    setPlaceholder(t) { this.placeholder = t; }
    onOpen() {
      this.modalEl.classList.add('prompt');
      for (const item of this.getItems()) {
        const row = Object.assign(document.createElement('div'), { className: 'suggestion-item', textContent: this.getItemText(item) });
        row.addEventListener('click', () => { this.close(); this.onChooseItem(item); });
        this.contentEl.append(row);
      }
    }
  }
  class Notice { constructor(text) { window.calls.notices.push(text); const n = Object.assign(document.createElement('div'), { className: 'notice', textContent: text }); document.body.append(n); setTimeout(() => n.remove(), 4000); } }
  class Plugin {
    constructor(a) { this.app = a; this.cleanup = []; }
    async loadData() { return window.storedSettings || null; }
    async saveData(d) { window.storedSettings = JSON.parse(JSON.stringify(d)); window.calls.settingsSaved.push(window.storedSettings); }
    addSettingTab(tab) { window.settingTab = tab; }
    registerEvent() {}
    register(fn) { this.cleanup.push(fn); }
    registerDomEvent(target, type, fn, opts) { target.addEventListener(type, fn, opts); this.cleanup.push(() => target.removeEventListener(type, fn, opts)); }
    addCommand(c) { window.calls.commands.push(c); }
    unload() { for (const fn of this.cleanup.splice(0)) fn(); }
  }
  class PluginSettingTab { constructor(a, p) { this.app = a; this.plugin = p; this.containerEl = Object.assign(document.createElement('div'), { className: 'vertical-tab-content' }); } }
  class Setting {
    constructor(parent) {
      this.settingEl = Object.assign(document.createElement('div'), { className: 'setting-item' });
      const info = Object.assign(document.createElement('div'), { className: 'setting-item-info' });
      this.nameEl = Object.assign(document.createElement('div'), { className: 'setting-item-name' });
      this.descEl = Object.assign(document.createElement('div'), { className: 'setting-item-description' });
      this.controlEl = Object.assign(document.createElement('div'), { className: 'setting-item-control' });
      info.append(this.nameEl, this.descEl);
      this.settingEl.append(info, this.controlEl);
      parent.append(this.settingEl);
    }
    setName(t) { this.nameEl.textContent = t; return this; }
    setDesc(t) { this.descEl.textContent = t; return this; }
    control(type, setup) {
      const input = document.createElement(type === 'dropdown' ? 'select' : 'input');
      if (type !== 'dropdown') input.type = type;
      const c = {
        setValue(v) { if (type === 'checkbox') input.checked = v; else input.value = v; return c; },
        setLimits(min, max, step) { input.min = min; input.max = max; input.step = step; return c; },
        setDynamicTooltip() { return c; },
        setPlaceholder() { return c; },
        addOption(v, label) { input.append(new Option(label, v)); return c; },
        onChange(fn) { input.addEventListener('change', () => fn(type === 'checkbox' ? input.checked : type === 'range' ? +input.value : input.value)); return c; },
      };
      this.controlEl.append(input);
      setup(c);
      return this;
    }
    addColorPicker(f) { return this.control('color', f); }
    addSlider(f) { return this.control('range', f); }
    addDropdown(f) { return this.control('dropdown', f); }
    addToggle(f) { return this.control('checkbox', f); }
    addText(f) { return this.control('text', f); }
  }
  // a handful of lucide icons, enough for the toolbar
  const ICONS = {
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    'move-up-right': '<path d="M13 5H19V11"/><path d="M19 5L5 19"/>',
    hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    'grid-3x3': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  const setIcon = (el, name) => {
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-${name}">${ICONS[name] || ''}</svg>`;
  };
  const obsidian = { Plugin, Modal, Notice, TFile, FuzzySuggestModal, PluginSettingTab, Setting, setIcon, getLanguage: () => params.get('lang') || 'en' };

  // ---- render the note ----
  document.querySelector('#embed-sample img').src = app.vault.getResourcePath(files[0]);
  document.querySelector('#plain').src = app.vault.getResourcePath(files[1]);

  // ---- load the plugin exactly as Obsidian would (CommonJS, require('obsidian')) ----
  const module = { exports: {} };
  new Function('module', 'exports', 'require', await (await fetch('../main.js')).text())(module, module.exports, (n) => { if (n === 'obsidian') return obsidian; throw new Error(`unexpected require: ${n}`); });
  const plugin = new module.exports(app);
  await plugin.onload();
  Object.assign(window, { plugin, app, files, texts, handlers, TFile, ready: true });
})().catch((e) => { window.loadError = String(e && e.stack || e); });
