'use strict';
/*
 * PhotoMark+ for Obsidian
 * Mark up images without leaving your notes: rectangles, ellipses, arrows,
 * numbered markers, solid blocks and pixelation. Saves straight back into the vault.
 *
 * Plain JavaScript on purpose: this file is the source, there is no build step.
 * https://github.com/VBV11/photomark-plus
 */
const obsidian = require('obsidian');
const { Plugin, Modal, Notice, TFile, FuzzySuggestModal, PluginSettingTab, Setting, setIcon } = obsidian;

const DEFAULT_SETTINGS = {
  color: '#ff1f1f',
  blockColor: '#000000', // solid blocks have their own color, black by default
  lineWidth: 0, // 0 = automatic (scales with the image)
  quality: 92, // JPEG / WebP quality
  saveMode: 'overwrite', // 'overwrite' | 'copy'
  copySuffix: '-marked',
  hoverButton: true,
  buttonPosition: 'top-right', // top-right | top-left | bottom-right | bottom-left
  language: 'auto', // auto (follow Obsidian) | en | nl
  tool: 'rect',
};
const EDITABLE = /^(png|jpe?g|webp)$/i;
const MAX_PIXELS = 16777216; // 4096 x 4096, the canvas limit on iOS
const TOOLS = [
  { id: 'rect', key: 'R', icon: 'square' },
  { id: 'ellipse', key: 'E', icon: 'circle' },
  { id: 'arrow', key: 'A', icon: 'move-up-right' },
  { id: 'number', key: 'N', icon: 'hash' },
  { id: 'block', key: 'B', icon: 'eye-off' },
  { id: 'pixelate', key: 'P', icon: 'grid-3x3' },
];

// ---------------------------------------------------------------- strings
const STRINGS = {
  en: {
    mark: 'Mark', markTitle: 'Mark up this image (PhotoMark+)', menuMark: 'Mark image', menuMarkNamed: (n) => `Mark image: ${n}`,
    command: 'Mark image', hint: 'Drag to draw', rect: 'Rectangle', ellipse: 'Ellipse', arrow: 'Arrow', number: 'Number', block: 'Block', pixelate: 'Pixelate',
    color: 'Color', undo: 'Undo', clear: 'Clear', cancel: 'Cancel', save: 'Save', saving: 'Saving…', loading: 'Loading…',
    loadFailed: 'This image could not be loaded.', tooLarge: 'This image is too large to edit here (more than 16 megapixels).',
    saveFailed: (e) => `Saving failed: ${e}`, saved: (n) => `Saved ${n}`, savedCopy: (n, k) => `Saved as ${n}` + (k ? ` (${k} link${k === 1 ? '' : 's'} updated)` : ''),
    webpFallback: 'This device cannot write WebP, so a PNG copy was saved instead.',
    discardTitle: 'Discard changes?', discardText: 'The marks you drew on this image will be lost.', discard: 'Discard', keepEditing: 'Keep editing',
    noFile: 'Open a note or an image first.', noImages: 'This note has no PNG, JPG or WebP image.', pickImage: 'Which image do you want to mark up?',
    sColor: 'Default color', sColorDesc: 'Used for new marks. You can still pick another color in the editor.',
    sBlockColor: 'Block color', sBlockColorDesc: 'Color of solid blocks that hide something (black by default). Changing the color while the Block tool is active also changes this.',
    sLineWidth: 'Line width', sLineWidthDesc: 'In pixels of the image. 0 = automatic, scaled to the size of the image.',
    sQuality: 'JPEG and WebP quality', sQualityDesc: 'Only used when saving JPEG or WebP files. PNG is always lossless.',
    sSaveMode: 'When saving', sSaveModeDesc: 'Overwrite replaces the original file (the previous version is gone unless you use File Recovery, Sync or git). Copy keeps the original and updates the links in the note you started from.',
    overwrite: 'Overwrite the original image', copy: 'Save a copy next to the original',
    sSuffix: 'Suffix for copies', sSuffixDesc: 'Added to the file name when saving a copy, for example screenshot-marked.png.',
    sHover: 'Show the Mark button on images', sHoverDesc: 'A small button on the image when you hover over it (on touch screens: after a tap). The context menu and the command keep working either way.',
    sPosition: 'Corner for the Mark button', sPositionDesc: 'Pick another corner if the button covers a button of another plugin.',
    topRight: 'Top right', topLeft: 'Top left', bottomRight: 'Bottom right', bottomLeft: 'Bottom left',
    sLanguage: 'Language', sLanguageDesc: 'Language of the buttons, menus and messages of this plugin.', followObsidian: 'Follow Obsidian', english: 'English', dutch: 'Nederlands',
  },
  nl: {
    mark: 'Markeren', markTitle: 'Deze afbeelding markeren (PhotoMark+)', menuMark: 'Afbeelding markeren', menuMarkNamed: (n) => `Markeren: ${n}`,
    command: 'Afbeelding markeren', hint: 'Sleep om te tekenen', rect: 'Kader', ellipse: 'Ovaal', arrow: 'Pijl', number: 'Nummer', block: 'Blok', pixelate: 'Vervagen',
    color: 'Kleur', undo: 'Ongedaan', clear: 'Wissen', cancel: 'Annuleren', save: 'Opslaan', saving: 'Opslaan…', loading: 'Laden…',
    loadFailed: 'Deze afbeelding kon niet worden geladen.', tooLarge: 'Deze afbeelding is te groot om hier te bewerken (meer dan 16 megapixel).',
    saveFailed: (e) => `Opslaan mislukt: ${e}`, saved: (n) => `Opgeslagen: ${n}`, savedCopy: (n, k) => `Opgeslagen als ${n}` + (k ? ` (${k} link${k === 1 ? '' : 's'} bijgewerkt)` : ''),
    webpFallback: 'Dit apparaat kan geen WebP schrijven, daarom is een PNG-kopie opgeslagen.',
    discardTitle: 'Wijzigingen weggooien?', discardText: 'De markeringen op deze afbeelding gaan verloren.', discard: 'Weggooien', keepEditing: 'Verder bewerken',
    noFile: 'Open eerst een notitie of afbeelding.', noImages: 'Deze notitie heeft geen PNG-, JPG- of WebP-afbeelding.', pickImage: 'Welke afbeelding wil je markeren?',
    sColor: 'Standaardkleur', sColorDesc: 'Voor nieuwe markeringen. In de editor kun je altijd een andere kleur kiezen.',
    sBlockColor: 'Kleur van blokken', sBlockColorDesc: 'Kleur van dichte blokken om iets te verbergen (standaard zwart). Een andere kleur kiezen terwijl Blok aan staat, verandert deze ook.',
    sLineWidth: 'Lijndikte', sLineWidthDesc: 'In pixels van de afbeelding. 0 = automatisch, afhankelijk van de grootte van de afbeelding.',
    sQuality: 'Kwaliteit JPEG en WebP', sQualityDesc: 'Alleen bij het opslaan van JPEG- of WebP-bestanden. PNG is altijd verliesvrij.',
    sSaveMode: 'Bij opslaan', sSaveModeDesc: 'Overschrijven vervangt het originele bestand (de vorige versie is weg, tenzij je File Recovery, Sync of git gebruikt). Kopie bewaart het origineel en werkt de links bij in de notitie waaruit je begon.',
    overwrite: 'Het origineel overschrijven', copy: 'Een kopie naast het origineel opslaan',
    sSuffix: 'Achtervoegsel voor kopieën', sSuffixDesc: 'Komt achter de bestandsnaam bij een kopie, bijvoorbeeld screenshot-marked.png.',
    sHover: 'Knop Markeren op afbeeldingen tonen', sHoverDesc: 'Een kleine knop op de afbeelding als je er met de muis op staat (op een touchscreen: na een tik). Het contextmenu en de opdracht blijven altijd werken.',
    sPosition: 'Hoek voor de knop Markeren', sPositionDesc: 'Kies een andere hoek als de knop een knop van een andere plugin bedekt.',
    topRight: 'Rechtsboven', topLeft: 'Linksboven', bottomRight: 'Rechtsonder', bottomLeft: 'Linksonder',
    sLanguage: 'Taal', sLanguageDesc: 'Taal van de knoppen, menu\'s en meldingen van deze plugin.', followObsidian: 'Volg Obsidian', english: 'English', dutch: 'Nederlands',
  },
};
let languageSetting = 'auto';
function language() {
  if (languageSetting && languageSetting !== 'auto') return languageSetting;
  try { if (typeof obsidian.getLanguage === 'function') return obsidian.getLanguage() || 'en'; } catch (e) { /* older API */ }
  try { return window.localStorage.getItem('language') || 'en'; } catch (e) { return 'en'; }
}
function t(key, ...args) {
  const table = STRINGS[language().split('-')[0]] || STRINGS.en;
  const s = table[key] !== undefined ? table[key] : STRINGS.en[key];
  return typeof s === 'function' ? s(...args) : (s === undefined ? key : s);
}

// ---------------------------------------------------------------- helpers
const isEditable = (f) => f instanceof TFile && EDITABLE.test(f.extension);
const mimeOf = (ext) => (/^jpe?g$/i.test(ext) ? 'image/jpeg' : /^webp$/i.test(ext) ? 'image/webp' : 'image/png');
// resource URLs carry ?mtime; strip query and hash and decode, so img.src and getResourcePath() can be compared
function plainUrl(url) {
  const s = String(url || '').split(/[?#]/)[0];
  try { return decodeURIComponent(s); } catch (e) { return s; }
}
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function iconButton(parent, icon, label, title, cls) {
  const b = el('button', cls || '');
  b.type = 'button';
  b.title = title || label;
  b.setAttribute('aria-label', title || label);
  const i = el('span', 'pmp-icon');
  setIcon(i, icon);
  b.append(i, el('span', 'pmp-label', label));
  parent.append(b);
  return b;
}

// Draws one mark. `index` is the running number for numbered markers.
function drawMark(ctx, m, index) {
  const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2), w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (m.tool) {
    case 'rect':
      ctx.strokeRect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'arrow': {
      const head = m.width * 4;
      const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2 - Math.cos(ang) * head * 0.7, m.y2 - Math.sin(ang) * head * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(m.x2, m.y2);
      ctx.lineTo(m.x2 - head * Math.cos(ang - Math.PI / 7), m.y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(m.x2 - head * Math.cos(ang + Math.PI / 7), m.y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'number': {
      const r = m.width * 3.2;
      ctx.beginPath();
      ctx.arc(m.x2, m.y2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index), m.x2, m.y2 + r * 0.06);
      break;
    }
    case 'block':
      ctx.fillRect(x, y, w, h);
      break;
    case 'pixelate': {
      if (w < 2 || h < 2) break;
      const block = Math.max(6, Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 120));
      const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
      const tmp = drawMark.tmp || (drawMark.tmp = document.createElement('canvas'));
      tmp.width = sw;
      tmp.height = sh;
      const tc = tmp.getContext('2d');
      tc.imageSmoothingEnabled = false;
      tc.clearRect(0, 0, sw, sh);
      tc.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- confirm dialog
class ConfirmModal extends Modal {
  constructor(app, title, text, done) {
    super(app);
    this.titleText = title;
    this.text = text;
    this.done = done;
    this.answered = false;
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    this.contentEl.append(el('p', '', this.text));
    const row = el('div', 'modal-button-container');
    const keep = el('button', 'mod-cta', t('keepEditing'));
    const discard = el('button', 'mod-warning', t('discard'));
    keep.addEventListener('click', () => this.answer(false));
    discard.addEventListener('click', () => this.answer(true));
    row.append(keep, discard);
    this.contentEl.append(row);
    keep.focus();
  }
  answer(yes) {
    if (this.answered) return;
    this.answered = true;
    this.close();
    this.done(yes);
  }
  onClose() {
    if (!this.answered) { this.answered = true; this.done(false); }
    this.contentEl.replaceChildren();
  }
}

// ---------------------------------------------------------------- the editor
class MarkupModal extends Modal {
  constructor(plugin, file, sourcePath) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.sourcePath = sourcePath || '';
    this.marks = [];
    this.current = null; // mark being drawn
    this.tool = TOOLS.some((x) => x.id === plugin.settings.tool) ? plugin.settings.tool : 'rect';
    this.color = plugin.settings.color;
    this.blockColor = plugin.settings.blockColor || DEFAULT_SETTINGS.blockColor;
    this.width = 4;
    this.busy = false;
    this.saved = false;
    this.confirming = false;
    this.objectUrl = null;
  }

  onOpen() {
    this.modalEl.classList.add('pmp-modal');
    this.contentEl.classList.add('pmp-content');
    this.contentEl.replaceChildren();

    // toolbar
    const bar = el('div', 'pmp-bar');
    const name = el('div', 'pmp-name');
    name.append(el('span', 'pmp-filename', this.file.name), el('span', 'pmp-hint', t('hint')));
    const tools = el('div', 'pmp-tools');
    this.toolButtons = {};
    for (const tool of TOOLS) {
      const b = iconButton(tools, tool.icon, t(tool.id), `${t(tool.id)} (${tool.key})`, 'pmp-tool');
      b.dataset.tool = tool.id;
      b.addEventListener('click', () => this.setTool(tool.id));
      this.toolButtons[tool.id] = b;
    }
    const colorWrap = el('label', 'pmp-color-wrap');
    colorWrap.title = t('color');
    this.colorInput = el('input', 'pmp-color');
    this.colorInput.type = 'color';
    this.colorInput.value = this.color;
    this.colorInput.setAttribute('aria-label', t('color'));
    // the Block tool has its own color (black by default), the other tools share one
    this.colorInput.addEventListener('input', () => { if (this.tool === 'block') this.blockColor = this.colorInput.value; else this.color = this.colorInput.value; });
    this.colorInput.addEventListener('change', () => {
      if (this.tool === 'block') this.plugin.settings.blockColor = this.blockColor; else this.plugin.settings.color = this.color;
      this.plugin.saveSettings();
    });
    colorWrap.append(this.colorInput);
    tools.append(colorWrap);
    const actions = el('div', 'pmp-actions');
    this.buttons = {
      undo: iconButton(actions, 'undo-2', t('undo'), `${t('undo')} (Ctrl/Cmd+Z)`, 'pmp-action'),
      clear: iconButton(actions, 'trash-2', t('clear'), t('clear'), 'pmp-action'),
      cancel: iconButton(actions, 'x', t('cancel'), `${t('cancel')} (Esc)`, 'pmp-action'),
      save: iconButton(actions, 'check', t('save'), `${t('save')} (Enter)`, 'pmp-action pmp-save mod-cta'),
    };
    this.buttons.undo.addEventListener('click', () => this.undo());
    this.buttons.clear.addEventListener('click', () => { if (!this.busy) { this.marks.length = 0; this.render(); } });
    this.buttons.cancel.addEventListener('click', () => this.close());
    this.buttons.save.addEventListener('click', () => this.save());
    bar.append(name, tools, actions);

    // canvas
    this.stage = el('div', 'pmp-stage');
    this.canvas = el('canvas', 'pmp-canvas');
    this.status = el('div', 'pmp-status', t('loading'));
    this.stage.append(this.canvas, this.status);
    this.contentEl.append(bar, this.stage);
    this.ctx = this.canvas.getContext('2d');
    this.setTool(this.tool);

    // image: load through a blob URL (an app:// URL would taint the canvas and block saving)
    this.img = new Image();
    this.img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = this.img;
      if (w * h > MAX_PIXELS) { this.status.textContent = t('tooLarge'); return; }
      this.canvas.width = w;
      this.canvas.height = h;
      this.autoWidth = Math.max(3, Math.round(Math.max(w, h) / 280));
      this.width = this.plugin.settings.lineWidth > 0 ? this.plugin.settings.lineWidth : this.autoWidth;
      this.status.textContent = '';
      requestAnimationFrame(() => this.fit());
      this.render();
    };
    this.img.onerror = () => { this.status.textContent = t('loadFailed'); };
    this.app.vault.readBinary(this.file).then((data) => {
      this.objectUrl = URL.createObjectURL(new Blob([data], { type: mimeOf(this.file.extension) }));
      this.img.src = this.objectUrl;
    }, (e) => { this.status.textContent = t('saveFailed', e.message); });

    // drawing
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.ready() || this.busy || (e.button && e.button !== 0)) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.point(e);
      this.current = { tool: this.tool, color: this.tool === 'block' ? this.blockColor : this.color, width: this.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      this.render();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.current) return;
      const p = this.point(e);
      this.current.x2 = p.x;
      this.current.y2 = p.y;
      this.render();
    });
    this.canvas.addEventListener('pointerup', () => {
      const m = this.current;
      if (!m) return;
      this.current = null;
      const min = m.width * 3; // a click without dragging is not a mark (except for a numbered marker)
      const big = Math.abs(m.x2 - m.x1) > min && Math.abs(m.y2 - m.y1) > min;
      const long = Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > min;
      if (m.tool === 'number' || (m.tool === 'arrow' ? long : big)) this.marks.push(m);
      this.render();
    });
    this.canvas.addEventListener('pointercancel', () => { this.current = null; this.render(); });

    // keyboard (the modal scope is active while the editor is open; Esc is handled by the modal itself)
    this.scope.register([], 'Enter', () => { this.save(); return false; });
    this.scope.register(['Mod'], 'S', () => { this.save(); return false; });
    this.scope.register(['Mod'], 'Z', () => { this.undo(); return false; });
    for (const tool of TOOLS) this.scope.register([], tool.key, () => { this.setTool(tool.id); return false; });
    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);
  }

  ready() { return !!(this.img && this.img.naturalWidth && this.canvas.width); }

  setTool(id) {
    this.tool = id;
    for (const [k, b] of Object.entries(this.toolButtons)) b.classList.toggle('is-active', k === id);
    this.canvas.classList.toggle('pmp-crosshair', id !== 'number');
    if (this.colorInput) this.colorInput.value = id === 'block' ? this.blockColor : this.color;
    if (this.plugin.settings.tool !== id) { this.plugin.settings.tool = id; this.plugin.saveSettings(); }
  }

  // show as large as possible (small images up to 3x), so you can draw precisely
  fit() {
    if (!this.ready() || !this.stage) return;
    const w = this.stage.clientWidth - 32, h = this.stage.clientHeight - 32;
    if (w <= 0 || h <= 0) return;
    const f = Math.min(w / this.canvas.width, h / this.canvas.height, 3);
    this.canvas.style.width = `${Math.round(this.canvas.width * f)}px`;
    this.canvas.style.height = `${Math.round(this.canvas.height * f)}px`;
  }

  // pointer position in image pixels (the canvas is shown scaled)
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * this.canvas.width),
      y: Math.round(((e.clientY - r.top) / r.height) * this.canvas.height),
    };
  }

  render() {
    if (this.ready()) {
      this.ctx.drawImage(this.img, 0, 0);
      let n = 0;
      for (const m of this.current ? [...this.marks, this.current] : this.marks) {
        if (m.tool === 'number') n++;
        drawMark(this.ctx, m, n);
      }
    }
    const empty = !this.marks.length;
    this.buttons.undo.disabled = empty || this.busy;
    this.buttons.clear.disabled = empty || this.busy;
    this.buttons.save.disabled = empty || this.busy;
  }

  undo() {
    if (this.busy) return;
    this.marks.pop();
    this.render();
  }

  async save() {
    if (!this.marks.length || this.busy || !this.ready()) return;
    this.busy = true;
    this.buttons.save.querySelector('.pmp-label').textContent = t('saving');
    this.render();
    try {
      const mime = mimeOf(this.file.extension);
      const blob = await new Promise((ok, fail) => this.canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob returned nothing'))), mime, this.plugin.settings.quality / 100));
      const data = await blob.arrayBuffer();
      const fallback = !!blob.type && blob.type !== mime; // e.g. WebP is not supported on this platform
      if (this.plugin.settings.saveMode === 'overwrite' && !fallback) {
        await this.app.vault.modifyBinary(this.file, data);
        new Notice(t('saved', this.file.name));
      } else {
        const ext = fallback ? (blob.type === 'image/jpeg' ? 'jpg' : 'png') : this.file.extension;
        const copy = await this.plugin.saveCopy(this.file, data, ext);
        const updated = await this.plugin.updateLinks(this.file, copy, this.sourcePath);
        new Notice((fallback ? `${t('webpFallback')} ` : '') + t('savedCopy', copy.name, updated));
      }
      this.saved = true;
      this.plugin.refreshImages(this.file);
      this.close();
    } catch (e) {
      this.busy = false;
      this.buttons.save.querySelector('.pmp-label').textContent = t('save');
      this.status.textContent = t('saveFailed', e.message);
      this.render();
    }
  }

  // Esc, the close button and clicking outside all end up here
  close() {
    if (this.busy && !this.saved) return;
    if (this.marks.length && !this.saved) {
      if (this.confirming) return;
      this.confirming = true;
      new ConfirmModal(this.app, t('discardTitle'), t('discardText'), (yes) => {
        this.confirming = false;
        if (yes) super.close();
      }).open();
      return;
    }
    super.close();
  }

  onClose() {
    window.removeEventListener('resize', this.onResize);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.contentEl.replaceChildren();
  }
}

class PickImageModal extends FuzzySuggestModal {
  constructor(app, files, onPick) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder(t('pickImage'));
  }
  getItems() { return this.files; }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onPick(f); }
}

// ---------------------------------------------------------------- settings
class PhotoMarkSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();
    new Setting(containerEl).setName(t('sLanguage')).setDesc(t('sLanguageDesc'))
      .addDropdown((d) => d.addOption('auto', t('followObsidian')).addOption('en', t('english')).addOption('nl', t('dutch')).setValue(s.language || 'auto')
        .onChange((v) => { s.language = v; save(); this.plugin.applyLanguage(); this.display(); }));
    new Setting(containerEl).setName(t('sColor')).setDesc(t('sColorDesc'))
      .addColorPicker((c) => c.setValue(s.color).onChange((v) => { s.color = v; save(); }));
    new Setting(containerEl).setName(t('sBlockColor')).setDesc(t('sBlockColorDesc'))
      .addColorPicker((c) => c.setValue(s.blockColor || DEFAULT_SETTINGS.blockColor).onChange((v) => { s.blockColor = v; save(); }));
    new Setting(containerEl).setName(t('sLineWidth')).setDesc(t('sLineWidthDesc'))
      .addSlider((sl) => sl.setLimits(0, 24, 1).setValue(s.lineWidth).setDynamicTooltip().onChange((v) => { s.lineWidth = v; save(); }));
    new Setting(containerEl).setName(t('sQuality')).setDesc(t('sQualityDesc'))
      .addSlider((sl) => sl.setLimits(50, 100, 1).setValue(s.quality).setDynamicTooltip().onChange((v) => { s.quality = v; save(); }));
    new Setting(containerEl).setName(t('sSaveMode')).setDesc(t('sSaveModeDesc'))
      .addDropdown((d) => d.addOption('overwrite', t('overwrite')).addOption('copy', t('copy')).setValue(s.saveMode)
        .onChange((v) => { s.saveMode = v; save(); this.display(); }));
    if (s.saveMode === 'copy') {
      new Setting(containerEl).setName(t('sSuffix')).setDesc(t('sSuffixDesc'))
        .addText((tx) => tx.setValue(s.copySuffix).onChange((v) => { s.copySuffix = v.replace(/[\\/:*?"<>|]/g, '').trim() || '-marked'; save(); }));
    }
    new Setting(containerEl).setName(t('sHover')).setDesc(t('sHoverDesc'))
      .addToggle((tg) => tg.setValue(s.hoverButton).onChange((v) => { s.hoverButton = v; save(); }));
    new Setting(containerEl).setName(t('sPosition')).setDesc(t('sPositionDesc'))
      .addDropdown((d) => d.addOption('top-right', t('topRight')).addOption('top-left', t('topLeft')).addOption('bottom-right', t('bottomRight')).addOption('bottom-left', t('bottomLeft'))
        .setValue(s.buttonPosition || 'top-right').onChange((v) => { s.buttonPosition = v; save(); }));
  }
}

// ---------------------------------------------------------------- plugin
module.exports = class PhotoMarkPlus extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    languageSetting = this.settings.language || 'auto';
    this.resourceIndex = new Map(); // plain resource URL -> file, for ![](path) images
    this.resourceIndexTime = 0;
    this.imageCache = new WeakMap(); // img -> { src, file }
    this.addSettingTab(new PhotoMarkSettingTab(this.app, this));
    this.setupHoverButton();

    // right-click on an image in the file explorer (and the "more options" menu of an open image)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!isEditable(file)) return;
      menu.addItem((item) => item.setTitle(t('menuMark')).setIcon('square').onClick(() => this.open(file)));
    }));
    // right-click in the editor on a line with an image
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      const source = (view && view.file && view.file.path) || '';
      for (const f of this.imagesInLine(editor.getLine(editor.getCursor().line), source)) {
        menu.addItem((item) => item.setTitle(t('menuMarkNamed', f.name)).setIcon('square').onClick(() => this.open(f, source)));
      }
    }));
    this.addCommand({ id: 'mark-image', name: t('command'), callback: () => this.markFromCommand() });
  }

  async saveSettings() { await this.saveData(this.settings); }

  // after the language setting changed: texts that are created once
  applyLanguage() {
    languageSetting = this.settings.language || 'auto';
    if (this.hoverButton) {
      this.hoverButton.textContent = t('mark');
      this.hoverButton.title = t('markTitle');
    }
    this.addCommand({ id: 'mark-image', name: t('command'), callback: () => this.markFromCommand() });
  }

  open(file, sourcePath) {
    new MarkupModal(this, file, sourcePath).open();
  }

  // after saving: images already on screen show the new version right away
  refreshImages(file) {
    const fresh = this.app.vault.getResourcePath(file);
    const key = plainUrl(fresh);
    for (const img of document.querySelectorAll('img')) {
      if (img.src !== fresh && plainUrl(img.src) === key) img.src = fresh;
    }
    this.imageCache = new WeakMap();
  }

  // "copy" mode: new file next to the original, never overwriting anything
  async saveCopy(file, data, ext) {
    const folder = file.parent && file.parent.path && file.parent.path !== '/' ? `${file.parent.path}/` : '';
    const base = `${folder}${file.basename}${this.settings.copySuffix}`;
    let path = `${base}.${ext}`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base}-${n}.${ext}`;
    return this.app.vault.createBinary(path, data);
  }

  // point the embeds in the note we started from at the copy; returns how many links changed
  async updateLinks(oldFile, newFile, sourcePath) {
    const note = sourcePath && this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(note instanceof TFile) || note.extension !== 'md') return 0;
    const cache = this.app.metadataCache.getFileCache(note);
    const embeds = (cache && cache.embeds) || [];
    const edits = [];
    for (const e of embeds) {
      const link = (e.link || '').split('#')[0];
      if (!link || this.resolve(link, note.path) !== oldFile) continue;
      const target = link.includes('/') ? `${link.slice(0, link.lastIndexOf('/') + 1)}${newFile.name}` : newFile.name;
      const o = e.original || '';
      let text = null;
      for (const form of [link, encodeURI(link), link.replace(/ /g, '%20')]) {
        if (o.includes(form)) { text = o.replace(form, form === link ? target : encodeURI(target)); break; }
      }
      if (text && e.position) edits.push({ from: e.position.start.offset, to: e.position.end.offset, text });
    }
    if (!edits.length) return 0;
    edits.sort((a, b) => b.from - a.from);
    await this.app.vault.process(note, (content) => {
      let out = content;
      for (const ed of edits) out = out.slice(0, ed.from) + ed.text + out.slice(ed.to);
      return out;
    });
    return edits.length;
  }

  // ---------- the floating "Mark" button ----------
  setupHoverButton() {
    const button = el('button', 'pmp-hover', t('mark'));
    button.type = 'button';
    button.title = t('markTitle');
    document.body.append(button);
    this.hoverButton = button;
    this.register(() => { button.remove(); this.hoverButton = null; });
    let current = null;
    let timer = 0;
    let lastTap = 0; // after a tap the browser fires synthetic mouse events: ignore those
    const hide = () => { window.clearTimeout(timer); button.classList.remove('is-visible'); current = null; };
    const hideLater = (ms) => { window.clearTimeout(timer); timer = window.setTimeout(hide, ms); };
    this.register(() => window.clearTimeout(timer));
    const show = (img, file, tapped) => {
      const r = img.getBoundingClientRect();
      if (r.width < 48 || r.height < 32 || r.bottom < 40 || r.top > window.innerHeight - 40) return false;
      window.clearTimeout(timer);
      current = { img, file, tapped: !!tapped };
      const pos = this.settings.buttonPosition || 'top-right';
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      button.style.top = pos.startsWith('top') ? `${Math.max(r.top, 0) + 8}px` : 'auto';
      button.style.bottom = pos.startsWith('bottom') ? `${Math.max(vh - r.bottom, 0) + 8}px` : 'auto';
      button.style.right = pos.endsWith('right') ? `${Math.max(vw - r.right, 0) + 8}px` : 'auto';
      button.style.left = pos.endsWith('left') ? `${Math.max(r.left, 0) + 8}px` : 'auto';
      button.classList.add('is-visible');
      return true;
    };
    const imageAt = (node) => (node instanceof HTMLImageElement && node.closest('.workspace-leaf-content, .hover-popover') ? node : null);
    const onImage = (e) => {
      if (!this.settings.hoverButton || Date.now() - lastTap < 2000) return;
      const img = imageAt(e.target);
      const file = img && this.fileOf(img);
      if (file) show(img, file);
    };
    this.registerDomEvent(document, 'mouseover', (e) => {
      if (e.target !== button) onImage(e);
      else if (current && !current.tapped) window.clearTimeout(timer);
    });
    // after scrolling the pointer can rest on an image without a new mouseover: show again on movement
    this.registerDomEvent(document, 'mousemove', (e) => { if (!current && !e.buttons) onImage(e); }, { passive: true });
    this.registerDomEvent(document, 'mouseout', (e) => {
      if (!current || current.tapped || (e.target !== current.img && e.target !== button)) return;
      if (e.relatedTarget === button || e.relatedTarget === current.img) return;
      hideLater(250);
    });
    // touch screens: tap an image = show the button for a few seconds
    this.registerDomEvent(document, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target === button || !this.settings.hoverButton) return;
      lastTap = Date.now();
      const img = imageAt(e.target);
      const file = img && this.fileOf(img);
      if (file && show(img, file, true)) hideLater(5000);
    }, { capture: true });
    this.registerDomEvent(document, 'scroll', () => { if (current) hide(); }, { capture: true, passive: true });
    this.registerDomEvent(window, 'resize', hide);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hide));
    this.registerEvent(this.app.workspace.on('layout-change', hide));
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); }); // keep focus in the editor
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const picked = current;
      hide();
      if (picked) this.open(picked.file, this.sourceOf(picked.img));
    });
  }

  // ---------- which vault file is this <img>? ----------
  fileOf(img) {
    const src = img.currentSrc || img.src;
    const c = this.imageCache.get(img);
    if (c && c.src === src) return c.file;
    const file = this.findFile(img, src);
    this.imageCache.set(img, { src, file });
    return file;
  }

  leafOf(node) {
    let leaf = null;
    this.app.workspace.iterateAllLeaves((l) => {
      if (!leaf && l.view && l.view.containerEl && l.view.containerEl.contains(node)) leaf = l;
    });
    return leaf;
  }

  // path of the note an image is shown in (used to update links in copy mode)
  sourceOf(img) {
    const leaf = this.leafOf(img);
    const view = leaf && leaf.view;
    return view && view.file && view.getViewType && view.getViewType() !== 'image' ? view.file.path : '';
  }

  findFile(img, src) {
    const leaf = this.leafOf(img);
    const view = leaf && leaf.view;
    if (view && view.getViewType && view.getViewType() === 'image' && view.file) return isEditable(view.file) ? view.file : null;
    const source = (view && view.file && view.file.path) || (this.app.workspace.getActiveFile() || {}).path || '';
    // ![[image.png]]: Obsidian keeps the link text in the src attribute of the embed
    const embed = img.closest('.internal-embed');
    const link = embed && embed.getAttribute('src');
    if (link) {
      const f = this.resolve(link.split('|')[0].split('#')[0], source);
      if (f) return isEditable(f) ? f : null;
    }
    // ![](path/image.png) and others: through the resource URL
    return this.fileFromUrl(src);
  }

  fileFromUrl(src) {
    const key = plainUrl(src);
    if (!key || /^(data|blob):/i.test(key)) return null; // external http(s) images simply never match a vault file
    let f = this.resourceIndex.get(key);
    if (!f && Date.now() - this.resourceIndexTime > 3000) {
      this.resourceIndex = new Map();
      for (const file of this.app.vault.getFiles()) {
        if (isEditable(file)) this.resourceIndex.set(plainUrl(this.app.vault.getResourcePath(file)), file);
      }
      this.resourceIndexTime = Date.now();
      f = this.resourceIndex.get(key);
    }
    return f && this.app.vault.getAbstractFileByPath(f.path) === f ? f : null;
  }

  resolve(link, sourcePath) {
    let path = String(link || '').trim();
    try { path = decodeURIComponent(path); } catch (e) { /* keep as is */ }
    if (!path) return null;
    const f = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath || '');
    if (f) return f;
    // relative path (![](./img/x.png)) from the folder of the note
    const folder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
    const parts = [];
    for (const d of `${folder}/${path}`.split('/')) {
      if (!d || d === '.') continue;
      if (d === '..') parts.pop();
      else parts.push(d);
    }
    const g = this.app.vault.getAbstractFileByPath(parts.join('/'));
    return g instanceof TFile ? g : null;
  }

  imagesInLine(text, sourcePath) {
    const found = [];
    const re = /!\[\[([^\]|#]+)[^\]]*\]\]|!\[[^\]]*\]\(\s*<?([^)>]+?)>?(?:\s+"[^"]*")?\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const f = this.resolve(m[1] || m[2], sourcePath);
      if (isEditable(f) && !found.includes(f)) found.push(f);
    }
    return found;
  }

  // command: the image on the cursor line, the open image, or pick one from the note
  markFromCommand() {
    const ws = this.app.workspace;
    const leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null;
    const view = leaf && leaf.view;
    if (view && view.getViewType && view.getViewType() === 'image' && isEditable(view.file)) return this.open(view.file);
    const file = ws.getActiveFile();
    if (!file) return new Notice(t('noFile'));
    if (isEditable(file)) return this.open(file);
    const editor = ws.activeEditor && ws.activeEditor.editor;
    if (editor) {
      const onLine = this.imagesInLine(editor.getLine(editor.getCursor().line), file.path);
      if (onLine.length === 1) return this.open(onLine[0], file.path);
    }
    const list = [];
    for (const e of ((this.app.metadataCache.getFileCache(file) || {}).embeds || [])) {
      const f = this.resolve((e.link || '').split('#')[0], file.path);
      if (isEditable(f) && !list.includes(f)) list.push(f);
    }
    if (!list.length) return new Notice(t('noImages'));
    if (list.length === 1) return this.open(list[0], file.path);
    return new PickImageModal(this.app, list, (f) => this.open(f, file.path)).open();
  }
};
