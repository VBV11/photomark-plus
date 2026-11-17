// A small stand-in for the parts of the Obsidian API that PhotoMark+ uses.
// Loaded by test/index.html so the plugin can run in a plain browser (see test/run.js).
// It is deliberately minimal and not a faithful copy of Obsidian.
(async () => {
  const params = new URLSearchParams(location.search);
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.setText = function (t) { this.textContent = t; };

  const folders = {};
  const folderOf = (dir) => (folders[dir] = folders[dir] || { path: dir, children: [] });
  class TFile {
    constructor(path, mtime) {
      this.path = path;
      this.name = path.split('/').pop();
      this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
      this.basename = this.extension ? this.name.slice(0, -this.extension.length - 1) : this.name;
      this.parent = folderOf(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/');
      this.parent.children.push(this);
      this.stat = { mtime };
    }
  }

  // ---- vault contents ----
  const files = [new TFile('Attachments/sample.png', 1000), new TFile('Attachments/second.png', 1000), new TFile('Network setup.md', 1000), new TFile('Other.md', 1000)];
  const binaries = {};
  for (const p of ['Attachments/sample.png', 'Attachments/second.png']) binaries[p] = await (await fetch(`vault/${p}`)).arrayBuffer();
  // a third image, only in the folder (not in the note): a JPEG made from sample.png
  {
    const bm = await createImageBitmap(new Blob([binaries['Attachments/sample.png']]));
    const c = new OffscreenCanvas(bm.width, bm.height);
    c.getContext('2d').drawImage(bm, 0, 0);
    binaries['Attachments/photo.jpg'] = await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer();
    files.push(new TFile('Attachments/photo.jpg', 1000));
  }
  const texts = {
    'Network setup.md': '# Network setup\n\nThe router dashboard after the change:\n\n![[Attachments/sample.png|500]]\n\nSame image as a markdown link: ![dashboard](Attachments/sample.png) and a second one\n![[second.png]]\n\nThe end.\n',
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
  // like app://<vault>/<path>?<mtime> in Obsidian; files made during a test are served by test/run.js from window.binaries
  const urlFor = (path, mtime) => new URL(`vault/${encodeURI(path)}?${mtime}`, location.href).href;
  const remove = (f) => {
    const i = files.indexOf(f);
    if (i >= 0) files.splice(i, 1);
    const j = f.parent.children.indexOf(f);
    if (j >= 0) f.parent.children.splice(j, 1);
    delete binaries[f.path];
  };

  window.calls = { modifyBinary: [], createBinary: [], process: [], notices: [], commands: [], settingsSaved: [], trash: [], getFiles: 0 };
  const handlers = {};
  const app = {
    vault: {
      getFiles: () => { window.calls.getFiles++; return files.slice(); },
      getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
      getResourcePath: (f) => urlFor(f.path, f.stat.mtime),
      adapter: { getResourcePath: (p) => urlFor(p, Date.now()) },
      readBinary: async (f) => { if (!binaries[f.path]) throw new Error('no such file'); return binaries[f.path].slice(0); },
      modifyBinary: async (f, buf) => { binaries[f.path] = buf; f.stat.mtime++; window.calls.modifyBinary.push({ path: f.path, bytes: buf.byteLength }); window.lastSaved = buf; },
      createBinary: async (path, buf) => { if (files.some((f) => f.path === path)) throw new Error('exists'); const f = new TFile(path, 2000); files.push(f); binaries[path] = buf; window.calls.createBinary.push({ path, bytes: buf.byteLength }); window.lastSaved = buf; return f; },
      process: async (f, fn) => { texts[f.path] = fn(texts[f.path]); window.calls.process.push(f.path); return texts[f.path]; },
      read: async (f) => texts[f.path],
      trash: async (f) => { window.calls.trash.push({ path: f.path, via: 'vault.trash' }); remove(f); },
    },
    fileManager: {
      trashFile: async (f) => { window.calls.trash.push({ path: f.path, via: 'fileManager.trashFile' }); remove(f); },
    },
    metadataCache: {
      getFirstLinkpathDest: (link) => files.find((f) => f.path === link) || files.find((f) => f.name === link || f.basename === link) || null,
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
        if (k.mods.includes('Mod') !== (e.ctrlKey || e.metaKey)) continue;
        if (k.mods.includes('Shift') !== e.shiftKey) continue;
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
    close() { const i = modalStack.indexOf(this); if (i < 0) return; modalStack.splice(i, 1); this.containerEl.remove(); this.onClose && this.onClose(); }
  }
  window.modalStack = modalStack;
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
    async loadData() { return window.storedSettings ? JSON.parse(JSON.stringify(window.storedSettings)) : null; }
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
    setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
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
  // the lucide icons the plugin uses (paths from https://lucide.dev, ISC license)
  const ICONS = {
    square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    'move-up-right': '<path d="M13 5H19V11"/><path d="M19 5L5 19"/>',
    hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    'grid-3x3': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    'redo-2': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
    'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'mouse-pointer-2': '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    minus: '<path d="M5 12h14"/>',
    type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    'flip-horizontal': '<path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
    'flip-vertical': '<path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>',
    'zoom-in': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
    'zoom-out': '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
  };
  window.missingIcons = new Set();
  const setIcon = (el, name) => {
    if (!ICONS[name]) window.missingIcons.add(name);
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-${name}">${ICONS[name] || ''}</svg>`;
  };
  const obsidian = { Plugin, Modal, Notice, TFile, FuzzySuggestModal, PluginSettingTab, Setting, setIcon };
  if (params.get('lang') !== 'none') obsidian.getLanguage = () => params.get('lang') || 'en';
  else obsidian.moment = { locale: () => 'nl' }; // older Obsidian without getLanguage(): the language comes from moment

  // ---- render the note ----
  document.querySelector('#embed-sample img').src = app.vault.getResourcePath(files[0]);
  document.querySelector('#plain').src = app.vault.getResourcePath(files[1]);

  // ---- load the plugin exactly as Obsidian would (CommonJS, require('obsidian')) ----
  const module = { exports: {} };
  new Function('module', 'exports', 'require', await (await fetch('../main.js')).text())(module, module.exports, (n) => { if (n === 'obsidian') return obsidian; throw new Error(`unexpected require: ${n}`); });
  window.storedSettings = params.get('settings') ? JSON.parse(params.get('settings')) : window.storedSettings;
  const plugin = new module.exports(app);
  await plugin.onload();
  Object.assign(window, { plugin, app, files, texts, binaries, handlers, TFile, ready: true });
})().catch((e) => { window.loadError = String(e && e.stack || e); });
