'use strict';
/*
 * PhotoMark+ for Obsidian
 * A fast photo editor inside your notes. Crop, rotate, flip and resize; adjust brightness,
 * contrast, color and sharpness; draw, highlight, add lines, arrows, shapes, text and numbered
 * markers; hide sensitive parts with a solid block, pixelation or blur. Browse the images of a
 * note like a gallery, delete an image, and save straight back into the vault.
 *
 * Plain JavaScript on purpose: this file is the source, there is no build step.
 * https://github.com/VBV11/photomark-plus
 */
const obsidian = require('obsidian');
const { Plugin, Modal, Notice, TFile, FuzzySuggestModal, PluginSettingTab, Setting, setIcon } = obsidian;

const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  language: 'auto', // auto (follow Obsidian) | en | nl
  hoverButton: true,
  buttonPosition: 'top-left', // top-left | top-right | bottom-left | bottom-right
  buttonStyle: 'label', // label | icon
  tool: 'rect',
  color: '#ff1f1f',
  highlightColor: '#ffd400',
  blockColor: '#ff1f1f',
  lineWidth: 0, // 0 = automatic (scales with the image)
  fontSize: 0, // 0 = automatic
  textBackground: false,
  saveMode: 'overwrite', // overwrite | copy
  copySuffix: '-edited',
  format: 'same', // same | png | jpeg | webp
  quality: 92, // JPEG / WebP quality
  afterSave: 'close', // close | stay | next
  gallery: 'auto', // auto (images in the note, otherwise the folder) | note | folder
  filmstrip: true,
  onSwitch: 'ask', // ask | save | discard
  confirmClose: true,
  confirmDelete: true,
  removeEmbedsOnDelete: true,
  showLabels: true,
};
const EDITABLE = /^(png|jpe?g|webp)$/i;
const MAX_PIXELS = 16777216; // 4096 x 4096, the canvas limit on iOS
const SWATCHES = ['#ff1f1f', '#ff8a00', '#ffd400', '#22c55e', '#0ea5e9', '#7c3aed', '#ec4899', '#000000', '#ffffff'];
const TOOLS = [
  { id: 'select', key: 'V', icon: 'mouse-pointer-2' },
  { id: 'pen', key: 'D', icon: 'pencil' },
  { id: 'highlighter', key: 'H', icon: 'highlighter' },
  { id: 'line', key: 'L', icon: 'minus' },
  { id: 'arrow', key: 'A', icon: 'move-up-right' },
  { id: 'rect', key: 'R', icon: 'square' },
  { id: 'ellipse', key: 'E', icon: 'circle' },
  { id: 'text', key: 'T', icon: 'type' },
  { id: 'number', key: 'N', icon: 'hash' },
  { id: 'block', key: 'B', icon: 'eye-off' },
  { id: 'pixelate', key: 'P', icon: 'grid-3x3' },
  { id: 'blur', key: 'U', icon: 'droplets' },
  { id: 'crop', key: 'C', icon: 'crop' },
];
const TOOL_IDS = TOOLS.map((x) => x.id);
const BOXES = new Set(['rect', 'ellipse', 'block', 'pixelate', 'blur']); // drag a box
const STROKES = new Set(['pen', 'highlighter']); // freehand
const NO_ADJUST = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, grayscale: false, sepia: false, invert: false };
const ASPECTS = [['free', null], ['original', 'original'], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['9:16', 9 / 16]];

// ---------------------------------------------------------------- strings
const STRINGS = {
  en: {
    edit: 'Edit', editTitle: 'Edit this image (PhotoMark+)', menuEdit: 'Edit image', menuEditNamed: (n) => `Edit image: ${n}`, command: 'Edit image',
    select: 'Select', pen: 'Pen', highlighter: 'Highlighter', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text',
    number: 'Number', block: 'Block', pixelate: 'Pixelate', blur: 'Blur', crop: 'Crop',
    hint_select: 'Click a mark to select it, drag to move it, Delete removes it',
    hint_pen: 'Draw freehand', hint_highlighter: 'Drag over text to highlight it',
    hint_line: 'Drag to draw, hold Shift for straight angles', hint_arrow: 'Drag to draw, hold Shift for straight angles',
    hint_rect: 'Drag to draw, hold Shift for a square', hint_ellipse: 'Drag to draw, hold Shift for a circle',
    hint_text: 'Click to type. Enter places the text, Shift+Enter starts a new line', hint_number: 'Click to place a numbered marker',
    hint_block: 'Drag over the part you want to hide', hint_pixelate: 'Drag over the part you want to hide', hint_blur: 'Drag over the part you want to hide',
    hint_crop: 'Drag the edges or the frame, then Apply (Enter)',
    undo: 'Undo', redo: 'Redo', rotateLeft: 'Rotate left', rotateRight: 'Rotate right', flipH: 'Flip horizontally', flipV: 'Flip vertically',
    adjust: 'Adjust', settings: 'Settings', deleteImage: 'Delete image', close: 'Close', save: 'Save', saving: 'Saving…',
    previous: 'Previous image', next: 'Next image', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomFit: 'Fit to window', zoom100: 'Actual size',
    clearMarks: 'Remove all marks', color: 'Color', width: 'Line width', fontSize: 'Text size', textBg: 'Background', auto: 'Auto',
    apply: 'Apply', cancel: 'Cancel', fullImage: 'Whole image', free: 'Free', original: 'Original',
    brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', warmth: 'Warmth', sharpness: 'Sharpness',
    grayscale: 'Black and white', sepia: 'Sepia', invert: 'Invert', size: 'Size', resetAdjust: 'Reset adjustments', imageSection: 'Image', sizeSection: 'Size when saving',
    sizeInfo: (w, h) => `${w} × ${h} px`, counter: (i, n) => `${i} / ${n}`, unsaved: 'unsaved changes',
    loading: 'Loading…', loadFailed: 'This image could not be loaded.', tooLarge: 'This image is too large to edit here (more than 16 megapixels).',
    saveFailed: (e) => `Saving failed: ${e}`, saved: (n) => `Saved ${n}`, savedCopy: (n, k) => `Saved as ${n}` + (k ? ` (${k} link${k === 1 ? '' : 's'} updated)` : ''),
    webpFallback: 'This device cannot write WebP, so a PNG was saved instead.',
    discardTitle: 'Discard changes?', discardText: 'Your changes to this image will be lost.', discard: 'Discard', keepEditing: 'Keep editing',
    switchTitle: 'Save your changes?', switchText: (n) => `${n} has changes that are not saved yet.`, saveAndGo: 'Save', dontSave: 'Don\'t save',
    deleteTitle: 'Delete image?', deleteText: (n) => `${n} is moved to the trash, as set in Obsidian under Files and links. Unsaved changes are lost.`,
    deleteEmbeds: (n) => `Also remove it from ${n}`, deleteConfirm: 'Delete', deleted: (n) => `Deleted ${n}`,
    deletedEmbeds: (n, k) => `Deleted ${n} and removed ${k} link${k === 1 ? '' : 's'} from the note`, deleteFailed: (e) => `Deleting failed: ${e}`,
    noFile: 'Open a note or an image first.', noImages: 'This note has no PNG, JPG or WebP image.', pickImage: 'Which image do you want to edit?',
    sGeneral: 'General', sButton: 'Edit button on images', sDrawing: 'Drawing', sSaving: 'Saving', sGallery: 'Browsing images', sDeleting: 'Deleting',
    sLanguage: 'Language', sLanguageDesc: 'Language of the buttons, menus and messages of this plugin.', followObsidian: 'Follow Obsidian', english: 'English', dutch: 'Nederlands',
    sHover: 'Show the Edit button', sHoverDesc: 'A button on an image when you hover over it (on touch screens: after a tap). The context menu and the command keep working either way.',
    sPosition: 'Position', sPositionDesc: 'Corner of the image where the Edit button appears.', topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', bottomRight: 'Bottom right',
    sButtonStyle: 'Button style', sButtonStyleDesc: 'Icon with the word Edit, or only the icon.', styleLabel: 'Icon and text', styleIcon: 'Icon only',
    sTool: 'Tool when the editor opens', sToolDesc: 'The editor remembers the tool you used last.',
    sColor: 'Color', sColorDesc: 'For lines, arrows, shapes, text and numbers.', sHighlightColor: 'Highlighter color', sHighlightColorDesc: 'Drawn see-through over the image.',
    sBlockColor: 'Block color', sBlockColorDesc: 'Color of the solid blocks that hide something.',
    sLineWidth: 'Line width', sLineWidthDesc: 'In pixels of the image. 0 = automatic, scaled to the size of the image.',
    sFontSize: 'Text size', sFontSizeDesc: 'In pixels of the image. 0 = automatic.', sTextBg: 'Background behind text', sTextBgDesc: 'A box behind text, so it stays readable on busy screenshots.',
    sSaveMode: 'When saving', sSaveModeDesc: 'Overwrite replaces the original file (the previous version is gone unless you use File Recovery, Sync or git). Copy keeps the original and updates the links in the note you started from.',
    overwrite: 'Overwrite the original image', copy: 'Save a copy next to the original',
    sSuffix: 'Suffix for copies', sSuffixDesc: 'Added to the file name of a copy, for example screenshot-edited.png.',
    sFormat: 'File type', sFormatDesc: 'Same keeps the type of the original. Another type is always saved as a new file next to the original, and the links in the note are updated.',
    sameFormat: 'Same as the original', sQuality: 'JPEG and WebP quality', sQualityDesc: 'Only used for JPEG and WebP. PNG is always lossless.',
    sAfterSave: 'After saving', sAfterSaveDesc: 'What the editor does after saving.', afterClose: 'Close the editor', afterStay: 'Keep editing', afterNext: 'Go to the next image',
    sGalleryMode: 'Images to browse', sGalleryModeDesc: 'Which images the previous and next buttons go through.',
    galleryAuto: 'The images in the note, otherwise the folder', galleryNote: 'The images in the note', galleryFolder: 'The images in the same folder',
    sFilmstrip: 'Show thumbnails', sFilmstripDesc: 'A strip with the other images at the bottom of the editor.',
    sOnSwitch: 'Unsaved changes when switching images', sOnSwitchDesc: 'When you go to another image while the current one has changes.', askMe: 'Ask', saveAuto: 'Save automatically', discardAuto: 'Discard the changes',
    sConfirmClose: 'Ask before closing with unsaved changes', sConfirmCloseDesc: 'Esc, the close button and clicking outside the editor first ask if you want to discard your changes.',
    sConfirmDelete: 'Ask before deleting', sConfirmDeleteDesc: 'Deleting an image always goes to the trash, as set in Obsidian under Files and links.',
    sRemoveEmbeds: 'Also remove the image from the note', sRemoveEmbedsDesc: 'When you delete an image, also remove its embeds from the note you opened it from.',
    sLabels: 'Show names in the toolbar', sLabelsDesc: 'Only on wide screens. On phones the toolbar always shows icons.',
  },
  nl: {
    edit: 'Bewerken', editTitle: 'Deze afbeelding bewerken (PhotoMark+)', menuEdit: 'Afbeelding bewerken', menuEditNamed: (n) => `Bewerken: ${n}`, command: 'Afbeelding bewerken',
    select: 'Selecteren', pen: 'Pen', highlighter: 'Markeerstift', line: 'Lijn', arrow: 'Pijl', rect: 'Kader', ellipse: 'Ovaal', text: 'Tekst',
    number: 'Nummer', block: 'Blok', pixelate: 'Pixelen', blur: 'Vervagen', crop: 'Bijsnijden',
    hint_select: 'Klik op een markering om hem te selecteren, sleep om te verplaatsen, Delete verwijdert hem',
    hint_pen: 'Teken uit de vrije hand', hint_highlighter: 'Sleep over tekst om hem te markeren',
    hint_line: 'Sleep om te tekenen, Shift voor rechte hoeken', hint_arrow: 'Sleep om te tekenen, Shift voor rechte hoeken',
    hint_rect: 'Sleep om te tekenen, Shift voor een vierkant', hint_ellipse: 'Sleep om te tekenen, Shift voor een cirkel',
    hint_text: 'Klik om te typen. Enter plaatst de tekst, Shift+Enter begint een nieuwe regel', hint_number: 'Klik om een genummerde markering te plaatsen',
    hint_block: 'Sleep over wat je wilt verbergen', hint_pixelate: 'Sleep over wat je wilt verbergen', hint_blur: 'Sleep over wat je wilt verbergen',
    hint_crop: 'Sleep de randen of het kader, daarna Toepassen (Enter)',
    undo: 'Ongedaan maken', redo: 'Opnieuw', rotateLeft: 'Linksom draaien', rotateRight: 'Rechtsom draaien', flipH: 'Horizontaal spiegelen', flipV: 'Verticaal spiegelen',
    adjust: 'Aanpassen', settings: 'Instellingen', deleteImage: 'Afbeelding verwijderen', close: 'Sluiten', save: 'Opslaan', saving: 'Opslaan…',
    previous: 'Vorige afbeelding', next: 'Volgende afbeelding', zoomIn: 'Inzoomen', zoomOut: 'Uitzoomen', zoomFit: 'Passend maken', zoom100: 'Ware grootte',
    clearMarks: 'Alle markeringen weg', color: 'Kleur', width: 'Lijndikte', fontSize: 'Tekstgrootte', textBg: 'Achtergrond', auto: 'Auto',
    apply: 'Toepassen', cancel: 'Annuleren', fullImage: 'Hele afbeelding', free: 'Vrij', original: 'Origineel',
    brightness: 'Helderheid', contrast: 'Contrast', saturation: 'Verzadiging', warmth: 'Warmte', sharpness: 'Scherpte',
    grayscale: 'Zwart-wit', sepia: 'Sepia', invert: 'Omkeren', size: 'Grootte', resetAdjust: 'Aanpassingen herstellen', imageSection: 'Afbeelding', sizeSection: 'Grootte bij opslaan',
    sizeInfo: (w, h) => `${w} × ${h} px`, counter: (i, n) => `${i} / ${n}`, unsaved: 'niet opgeslagen',
    loading: 'Laden…', loadFailed: 'Deze afbeelding kon niet worden geladen.', tooLarge: 'Deze afbeelding is te groot om hier te bewerken (meer dan 16 megapixel).',
    saveFailed: (e) => `Opslaan mislukt: ${e}`, saved: (n) => `Opgeslagen: ${n}`, savedCopy: (n, k) => `Opgeslagen als ${n}` + (k ? ` (${k} link${k === 1 ? '' : 's'} bijgewerkt)` : ''),
    webpFallback: 'Dit apparaat kan geen WebP schrijven, daarom is een PNG opgeslagen.',
    discardTitle: 'Wijzigingen weggooien?', discardText: 'Je wijzigingen aan deze afbeelding gaan verloren.', discard: 'Weggooien', keepEditing: 'Verder bewerken',
    switchTitle: 'Wijzigingen opslaan?', switchText: (n) => `${n} heeft wijzigingen die nog niet zijn opgeslagen.`, saveAndGo: 'Opslaan', dontSave: 'Niet opslaan',
    deleteTitle: 'Afbeelding verwijderen?', deleteText: (n) => `${n} gaat naar de prullenbak, zoals ingesteld in Obsidian bij Bestanden en links. Niet opgeslagen wijzigingen gaan verloren.`,
    deleteEmbeds: (n) => `Ook uit ${n} halen`, deleteConfirm: 'Verwijderen', deleted: (n) => `Verwijderd: ${n}`,
    deletedEmbeds: (n, k) => `Verwijderd: ${n}, en ${k} link${k === 1 ? '' : 's'} uit de notitie gehaald`, deleteFailed: (e) => `Verwijderen mislukt: ${e}`,
    noFile: 'Open eerst een notitie of afbeelding.', noImages: 'Deze notitie heeft geen PNG-, JPG- of WebP-afbeelding.', pickImage: 'Welke afbeelding wil je bewerken?',
    sGeneral: 'Algemeen', sButton: 'Knop Bewerken op afbeeldingen', sDrawing: 'Tekenen', sSaving: 'Opslaan', sGallery: 'Bladeren door afbeeldingen', sDeleting: 'Verwijderen',
    sLanguage: 'Taal', sLanguageDesc: 'Taal van de knoppen, menu\'s en meldingen van deze plugin.', followObsidian: 'Volg Obsidian', english: 'English', dutch: 'Nederlands',
    sHover: 'Knop Bewerken tonen', sHoverDesc: 'Een knop op een afbeelding als je er met de muis op staat (op een touchscreen: na een tik). Het contextmenu en de opdracht blijven altijd werken.',
    sPosition: 'Plaats', sPositionDesc: 'Hoek van de afbeelding waar de knop Bewerken komt.', topLeft: 'Linksboven', topRight: 'Rechtsboven', bottomLeft: 'Linksonder', bottomRight: 'Rechtsonder',
    sButtonStyle: 'Uiterlijk van de knop', sButtonStyleDesc: 'Icoon met het woord Bewerken, of alleen het icoon.', styleLabel: 'Icoon en tekst', styleIcon: 'Alleen icoon',
    sTool: 'Gereedschap bij openen', sToolDesc: 'De editor onthoudt het gereedschap dat je het laatst gebruikte.',
    sColor: 'Kleur', sColorDesc: 'Voor lijnen, pijlen, vormen, tekst en nummers.', sHighlightColor: 'Kleur markeerstift', sHighlightColorDesc: 'Doorzichtig over de afbeelding getekend.',
    sBlockColor: 'Kleur van blokken', sBlockColorDesc: 'Kleur van de dichte blokken die iets verbergen.',
    sLineWidth: 'Lijndikte', sLineWidthDesc: 'In pixels van de afbeelding. 0 = automatisch, afhankelijk van de grootte van de afbeelding.',
    sFontSize: 'Tekstgrootte', sFontSizeDesc: 'In pixels van de afbeelding. 0 = automatisch.', sTextBg: 'Achtergrond achter tekst', sTextBgDesc: 'Een vlak achter de tekst, zodat hij leesbaar blijft op drukke screenshots.',
    sSaveMode: 'Bij opslaan', sSaveModeDesc: 'Overschrijven vervangt het originele bestand (de vorige versie is weg, tenzij je File Recovery, Sync of git gebruikt). Kopie bewaart het origineel en werkt de links bij in de notitie waaruit je begon.',
    overwrite: 'Het origineel overschrijven', copy: 'Een kopie naast het origineel opslaan',
    sSuffix: 'Achtervoegsel voor kopieën', sSuffixDesc: 'Komt achter de bestandsnaam van een kopie, bijvoorbeeld screenshot-edited.png.',
    sFormat: 'Bestandstype', sFormatDesc: 'Zelfde houdt het type van het origineel. Een ander type wordt altijd als nieuw bestand naast het origineel opgeslagen, en de links in de notitie worden bijgewerkt.',
    sameFormat: 'Zelfde als het origineel', sQuality: 'Kwaliteit JPEG en WebP', sQualityDesc: 'Alleen voor JPEG en WebP. PNG is altijd verliesvrij.',
    sAfterSave: 'Na opslaan', sAfterSaveDesc: 'Wat de editor doet na het opslaan.', afterClose: 'De editor sluiten', afterStay: 'Verder bewerken', afterNext: 'Naar de volgende afbeelding',
    sGalleryMode: 'Bladeren door', sGalleryModeDesc: 'Door welke afbeeldingen de knoppen vorige en volgende gaan.',
    galleryAuto: 'De afbeeldingen in de notitie, anders de map', galleryNote: 'De afbeeldingen in de notitie', galleryFolder: 'De afbeeldingen in dezelfde map',
    sFilmstrip: 'Miniaturen tonen', sFilmstripDesc: 'Een strook met de andere afbeeldingen onderaan de editor.',
    sOnSwitch: 'Niet opgeslagen wijzigingen bij wisselen', sOnSwitchDesc: 'Als je naar een andere afbeelding gaat terwijl de huidige wijzigingen heeft.', askMe: 'Vragen', saveAuto: 'Automatisch opslaan', discardAuto: 'Wijzigingen weggooien',
    sConfirmClose: 'Vragen bij sluiten met niet opgeslagen wijzigingen', sConfirmCloseDesc: 'Esc, de sluitknop en klikken naast de editor vragen eerst of je je wijzigingen wilt weggooien.',
    sConfirmDelete: 'Vragen voor verwijderen', sConfirmDeleteDesc: 'Verwijderen gaat altijd naar de prullenbak, zoals ingesteld in Obsidian bij Bestanden en links.',
    sRemoveEmbeds: 'Afbeelding ook uit de notitie halen', sRemoveEmbedsDesc: 'Bij verwijderen ook de verwijzingen naar de afbeelding uit de notitie halen waarin je hem opende.',
    sLabels: 'Namen in de werkbalk tonen', sLabelsDesc: 'Alleen op brede schermen. Op telefoons toont de werkbalk altijd iconen.',
  },
};
let languageSetting = 'auto';
function language() {
  if (languageSetting && languageSetting !== 'auto') return languageSetting;
  try { if (typeof obsidian.getLanguage === 'function') return obsidian.getLanguage() || 'en'; } catch (e) { /* older API */ }
  try { if (obsidian.moment && typeof obsidian.moment.locale === 'function') return obsidian.moment.locale() || 'en'; } catch (e) { /* no moment */ }
  return 'en';
}
function t(key, ...args) {
  const table = STRINGS[String(language()).split('-')[0]] || STRINGS.en;
  const s = table[key] !== undefined ? table[key] : STRINGS.en[key];
  return typeof s === 'function' ? s(...args) : (s === undefined ? key : s);
}

// ---------------------------------------------------------------- settings (one list for the settings tab and the panel in the editor)
const SETTINGS_SPEC = [
  { heading: 'sGeneral' },
  { key: 'language', type: 'dropdown', name: 'sLanguage', desc: 'sLanguageDesc', options: [['auto', 'followObsidian'], ['en', 'english'], ['nl', 'dutch']], redraw: true },
  { key: 'showLabels', type: 'toggle', name: 'sLabels', desc: 'sLabelsDesc' },
  { heading: 'sButton' },
  { key: 'hoverButton', type: 'toggle', name: 'sHover', desc: 'sHoverDesc' },
  { key: 'buttonPosition', type: 'dropdown', name: 'sPosition', desc: 'sPositionDesc', options: [['top-left', 'topLeft'], ['top-right', 'topRight'], ['bottom-left', 'bottomLeft'], ['bottom-right', 'bottomRight']] },
  { key: 'buttonStyle', type: 'dropdown', name: 'sButtonStyle', desc: 'sButtonStyleDesc', options: [['label', 'styleLabel'], ['icon', 'styleIcon']] },
  { heading: 'sDrawing' },
  { key: 'tool', type: 'dropdown', name: 'sTool', desc: 'sToolDesc', options: TOOLS.filter((x) => x.id !== 'crop').map((x) => [x.id, x.id]) },
  { key: 'color', type: 'color', name: 'sColor', desc: 'sColorDesc' },
  { key: 'highlightColor', type: 'color', name: 'sHighlightColor', desc: 'sHighlightColorDesc' },
  { key: 'blockColor', type: 'color', name: 'sBlockColor', desc: 'sBlockColorDesc' },
  { key: 'lineWidth', type: 'slider', name: 'sLineWidth', desc: 'sLineWidthDesc', min: 0, max: 24, step: 1 },
  { key: 'fontSize', type: 'slider', name: 'sFontSize', desc: 'sFontSizeDesc', min: 0, max: 160, step: 2 },
  { key: 'textBackground', type: 'toggle', name: 'sTextBg', desc: 'sTextBgDesc' },
  { heading: 'sSaving' },
  { key: 'saveMode', type: 'dropdown', name: 'sSaveMode', desc: 'sSaveModeDesc', options: [['overwrite', 'overwrite'], ['copy', 'copy']], redraw: true },
  { key: 'format', type: 'dropdown', name: 'sFormat', desc: 'sFormatDesc', options: [['same', 'sameFormat'], ['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']], redraw: true },
  { key: 'copySuffix', type: 'text', name: 'sSuffix', desc: 'sSuffixDesc', when: (s) => s.saveMode === 'copy' || s.format !== 'same',
    clean: (v) => String(v).replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || '-edited' },
  { key: 'quality', type: 'slider', name: 'sQuality', desc: 'sQualityDesc', min: 50, max: 100, step: 1 },
  { key: 'afterSave', type: 'dropdown', name: 'sAfterSave', desc: 'sAfterSaveDesc', options: [['close', 'afterClose'], ['stay', 'afterStay'], ['next', 'afterNext']] },
  { key: 'confirmClose', type: 'toggle', name: 'sConfirmClose', desc: 'sConfirmCloseDesc' },
  { heading: 'sGallery' },
  { key: 'gallery', type: 'dropdown', name: 'sGalleryMode', desc: 'sGalleryModeDesc', options: [['auto', 'galleryAuto'], ['note', 'galleryNote'], ['folder', 'galleryFolder']] },
  { key: 'filmstrip', type: 'toggle', name: 'sFilmstrip', desc: 'sFilmstripDesc' },
  { key: 'onSwitch', type: 'dropdown', name: 'sOnSwitch', desc: 'sOnSwitchDesc', options: [['ask', 'askMe'], ['save', 'saveAuto'], ['discard', 'discardAuto']] },
  { heading: 'sDeleting' },
  { key: 'confirmDelete', type: 'toggle', name: 'sConfirmDelete', desc: 'sConfirmDeleteDesc' },
  { key: 'removeEmbedsOnDelete', type: 'toggle', name: 'sRemoveEmbeds', desc: 'sRemoveEmbedsDesc' },
];
// renders SETTINGS_SPEC with Obsidian's Setting component into `container`; `changed(key)` after every change
function renderSettings(container, plugin, changed) {
  container.empty();
  const s = plugin.settings;
  for (const spec of SETTINGS_SPEC) {
    if (spec.heading) { new Setting(container).setName(t(spec.heading)).setHeading(); continue; }
    if (spec.when && !spec.when(s)) continue;
    const row = new Setting(container).setName(t(spec.name)).setDesc(t(spec.desc));
    const done = async (v) => {
      s[spec.key] = spec.clean ? spec.clean(v) : v;
      await plugin.saveSettings();
      if (spec.key === 'language') plugin.applyLanguage();
      if (spec.key === 'hoverButton' || spec.key === 'buttonStyle') plugin.applyButtonStyle();
      if (changed) changed(spec.key);
      if (spec.redraw) renderSettings(container, plugin, changed);
    };
    if (spec.type === 'toggle') row.addToggle((c) => c.setValue(!!s[spec.key]).onChange(done));
    else if (spec.type === 'color') row.addColorPicker((c) => c.setValue(s[spec.key]).onChange(done));
    else if (spec.type === 'slider') row.addSlider((c) => c.setLimits(spec.min, spec.max, spec.step).setValue(s[spec.key]).setDynamicTooltip().onChange(done));
    else if (spec.type === 'text') row.addText((c) => c.setValue(s[spec.key]).onChange(done));
    else if (spec.type === 'dropdown') {
      row.addDropdown((c) => {
        for (const [value, label] of spec.options) c.addOption(value, STRINGS.en[label] !== undefined ? t(label) : label);
        c.setValue(s[spec.key]).onChange(done);
      });
    }
  }
}

// ---------------------------------------------------------------- helpers
const isEditable = (f) => f instanceof TFile && EDITABLE.test(f.extension);
const mimeOf = (ext) => (/^jpe?g$/i.test(ext) ? 'image/jpeg' : /^webp$/i.test(ext) ? 'image/webp' : 'image/png');
const extOf = (mime) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
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
  const b = el('button', `pmp-btn ${cls || ''}`.trim());
  b.type = 'button';
  b.title = title || label;
  b.setAttribute('aria-label', label);
  const i = el('span', 'pmp-icon');
  setIcon(i, icon);
  if (!i.querySelector('svg')) b.classList.add('pmp-no-icon'); // icon missing in this Obsidian version: show the name
  b.append(i, el('span', 'pmp-label', label));
  if (parent) parent.append(b);
  return b;
}
function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
// marks are saved in the undo history without the cached measurements (keys starting with _)
const snapshot = (state) => JSON.stringify(state, (k, v) => (k.startsWith('_') ? undefined : v));
const TEXT_INPUTS = /^(text|search|number|email|url|password|tel)$/i;
const isTyping = () => {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) return true;
  return a.tagName === 'INPUT' && TEXT_INPUTS.test(a.type || 'text');
};
// arrow keys on a focused slider move the slider, not to another image
const onSlider = () => { const a = document.activeElement; return !!a && a.tagName === 'INPUT' && a.type === 'range'; };

// ---------------------------------------------------------------- image processing
// rot (0/90/180/270) and flip (horizontal mirror, applied before the rotation)
function orient(src, rot, flip) {
  const w = src.width, h = src.height, swap = rot % 180 !== 0;
  const c = canvasOf(swap ? h : w, swap ? w : h);
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((rot * Math.PI) / 180);
  if (flip) x.scale(-1, 1);
  x.drawImage(src, -w / 2, -h / 2);
  return c;
}
const isNeutral = (a) => Object.keys(NO_ADJUST).every((k) => a[k] === NO_ADJUST[k]);
// brightness, contrast, warmth, saturation, black and white, sepia, invert and sharpness, on a copy of `src`
function adjust(src, a, scale) {
  const w = Math.max(1, Math.round(src.width * (scale || 1))), h = Math.max(1, Math.round(src.height * (scale || 1)));
  const c = canvasOf(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  const bri = (a.brightness || 0) * 1.28;
  const cf = (a.contrast || 0) * 2.55;
  const f = (259 * (cf + 255)) / (255 * (259 - cf));
  const warm = (a.warmth || 0) * 0.45;
  const lut = (shift) => {
    const l = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) l[v] = f * (v + bri + shift - 128) + 128;
    return l;
  };
  const lr = lut(warm), lg = lut(0), lb = lut(-warm);
  const sat = a.grayscale ? 0 : 1 + (a.saturation || 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
    if (sat !== 1) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    }
    if (a.sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = sr; g = sg; b = sb;
    }
    if (a.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  if (a.sharpness > 0) {
    const k = (a.sharpness / 100) * 0.9;
    const s = new Uint8ClampedArray(d);
    const row = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let xx = 1; xx < w - 1; xx++) {
        const i = y * row + xx * 4;
        for (let ch = 0; ch < 3; ch++) {
          const p = i + ch;
          d[p] = s[p] * (1 + 4 * k) - k * (s[p - 4] + s[p + 4] + s[p - row] + s[p + row]);
        }
      }
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
// pixelate or blur a rectangle of a canvas in place (device pixels)
function obscure(ctx, kind, x, y, w, h, cell) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(ctx.canvas.width - x, Math.ceil(w)); h = Math.min(ctx.canvas.height - y, Math.ceil(h));
  if (w < 2 || h < 2) return;
  const block = cell || cellSize(kind, ctx.canvas.width, ctx.canvas.height);
  if (kind === 'pixelate') {
    // every block becomes the exact average of its pixels: nothing of the original detail survives
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    for (let by = 0; by < h; by += block) {
      for (let bx = 0; bx < w; bx += block) {
        const ex = Math.min(w, bx + block), ey = Math.min(h, by + block);
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = by; yy < ey; yy++) {
          for (let xx = bx, i = (yy * w + bx) * 4; xx < ex; xx++, i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++; }
        }
        r /= n; g /= n; b /= n; a /= n;
        for (let yy = by; yy < ey; yy++) {
          for (let xx = bx, i = (yy * w + bx) * 4; xx < ex; xx++, i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; }
        }
      }
    }
    ctx.putImageData(img, x, y);
    return;
  }
  // blur: shrink in halving steps (each step averages 2 x 2 pixels), then scale up smoothly
  const tw = Math.max(1, Math.round(w / block)), th = Math.max(1, Math.round(h / block));
  let src = ctx.canvas, sx = x, sy = y, sw = w, sh = h;
  while (sw / 2 >= tw && sh / 2 >= th) {
    const c = canvasOf(Math.max(1, Math.round(sw / 2)), Math.max(1, Math.round(sh / 2)));
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

// size of the blocks of pixelate and blur, from the size of the whole image (stored with the mark)
function cellSize(kind, w, h) {
  const big = Math.max(w, h);
  return Math.max(6, Math.round(big / (kind === 'blur' ? 100 : 120)));
}

// ---------------------------------------------------------------- marks
function boxOf(m) {
  if (m.points) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of m.points) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    const pad = (m.width || 0) / 2;
    return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + 2 * pad, h: y2 - y1 + 2 * pad };
  }
  if (m.tool === 'text') return m._box || { x: m.x, y: m.y, w: m.size * 4, h: m.size * 1.3 };
  if (m.tool === 'number') { const r = m.width * 3.2; return { x: m.x - r, y: m.y - r, w: 2 * r, h: 2 * r }; }
  const pad = BOXES.has(m.tool) ? 0 : (m.width || 0) * 2;
  return { x: Math.min(m.x1, m.x2) - pad, y: Math.min(m.y1, m.y2) - pad, w: Math.abs(m.x2 - m.x1) + 2 * pad, h: Math.abs(m.y2 - m.y1) + 2 * pad };
}
function moveMark(m, dx, dy) {
  if (m.points) m.points = m.points.map(([x, y]) => [x + dx, y + dy]);
  if ('x' in m) { m.x += dx; m.y += dy; }
  if ('x1' in m) { m.x1 += dx; m.y1 += dy; m.x2 += dx; m.y2 += dy; }
  delete m._box;
}
// map every coordinate of a mark with fn([x, y]) -> [x, y]
function mapMark(m, fn) {
  if (m.tool === 'text' && m._box) { // text stays upright: move it so that its centre follows
    const b = m._box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const [nx, ny] = fn([cx, cy]);
    m.x += nx - cx;
    m.y += ny - cy;
    delete m._box;
    return;
  }
  if (m.points) m.points = m.points.map((p) => fn(p));
  if ('x' in m) [m.x, m.y] = fn([m.x, m.y]);
  if ('x1' in m) { [m.x1, m.y1] = fn([m.x1, m.y1]); [m.x2, m.y2] = fn([m.x2, m.y2]); }
  delete m._box;
}
// draws one mark on a context that is translated so that (0, 0) is the top left of the oriented image
function drawMark(ctx, m, index, ox, oy) {
  ctx.save();
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2), w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
  switch (m.tool) {
    case 'pen':
    case 'highlighter': {
      if (m.tool === 'highlighter') { ctx.globalAlpha = 0.38; ctx.lineCap = 'butt'; }
      const p = m.points;
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
      for (let i = 1; i < p.length - 1; i++) { // smooth through the midpoints
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
      break;
    }
    case 'line':
      ctx.beginPath();
      ctx.moveTo(m.x1, m.y1);
      ctx.lineTo(m.x2, m.y2);
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
    case 'rect':
      ctx.strokeRect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'block':
      ctx.fillRect(x, y, w, h);
      break;
    case 'pixelate':
    case 'blur':
      obscure(ctx, m.tool, x - ox, y - oy, w, h, m.cell);
      break;
    case 'number': {
      const r = m.width * 3.2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = contrastColor(m.color);
      ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index), m.x, m.y + r * 0.06);
      break;
    }
    case 'text': {
      const lines = String(m.text || '').split('\n');
      ctx.font = `600 ${m.size}px sans-serif`;
      ctx.textBaseline = 'top';
      const lh = m.size * 1.25;
      const tw = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
      const pad = m.bg ? m.size * 0.3 : 0;
      m._box = { x: m.x - pad, y: m.y - pad, w: tw + 2 * pad, h: lines.length * lh + 2 * pad };
      if (m.bg) {
        ctx.fillStyle = contrastColor(m.color);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(m._box.x, m._box.y, m._box.w, m._box.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = m.color;
      }
      lines.forEach((l, i) => ctx.fillText(l, m.x, m.y + i * lh));
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
// black or white, whichever reads better on `hex`
function contrastColor(hex) {
  const v = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
  const k = len ? clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
}
function hits(m, x, y, tol) {
  if (m.tool === 'line' || m.tool === 'arrow') return distToSegment(x, y, m.x1, m.y1, m.x2, m.y2) <= m.width + tol;
  if (m.points) {
    for (let i = 0; i < m.points.length; i++) {
      const a = m.points[i], b = m.points[Math.min(i + 1, m.points.length - 1)];
      if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= m.width / 2 + tol) return true;
    }
    return false;
  }
  const b = boxOf(m);
  return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
}

// ---------------------------------------------------------------- dialogs
// a question with buttons and optionally one checkbox; done(choiceId | null, checked)
class ChoiceModal extends Modal {
  constructor(app, opts, done) {
    super(app);
    this.opts = opts;
    this.done = done;
    this.answered = false;
  }
  onOpen() {
    this.modalEl.classList.add('pmp-dialog');
    this.titleEl.setText(this.opts.title);
    this.contentEl.append(el('p', '', this.opts.text));
    if (this.opts.check) {
      const label = el('label', 'pmp-check');
      this.box = el('input');
      this.box.type = 'checkbox';
      this.box.checked = !!this.opts.check.value;
      label.append(this.box, el('span', '', this.opts.check.label));
      this.contentEl.append(label);
    }
    const row = el('div', 'modal-button-container');
    let focus = null;
    for (const c of this.opts.choices) {
      const b = el('button', c.cta ? 'mod-cta' : c.warning ? 'mod-warning' : '', c.label);
      b.dataset.choice = c.id;
      b.addEventListener('click', () => this.answer(c.id));
      row.append(b);
      if (c.focus) focus = b;
    }
    this.contentEl.append(row);
    if (focus) focus.focus();
  }
  answer(id) {
    if (this.answered) return;
    this.answered = true;
    const checked = this.box ? this.box.checked : false;
    this.close();
    this.done(id, checked);
  }
  onClose() {
    if (!this.answered) { this.answered = true; this.done(null, false); }
    this.contentEl.replaceChildren();
  }
}
const ask = (app, opts) => new Promise((resolve) => new ChoiceModal(app, opts, (id, checked) => resolve({ id, checked })).open());

// ---------------------------------------------------------------- the editor
const freshState = () => ({ rot: 0, flip: false, crop: null, adj: Object.assign({}, NO_ADJUST), size: 100, marks: [] });

class EditorModal extends Modal {
  constructor(plugin, file, sourcePath) {
    super(plugin.app);
    this.plugin = plugin;
    this.s = plugin.settings;
    this.sourcePath = sourcePath || '';
    this.gallery = plugin.galleryFor(file, this.sourcePath);
    this.index = Math.max(0, this.gallery.indexOf(file));
    this.file = file;
    this.tool = TOOL_IDS.includes(this.s.tool) && this.s.tool !== 'crop' ? this.s.tool : 'rect';
    this.state = freshState();
    this.history = [snapshot(this.state)];
    this.hIndex = 0;
    this.baseline = this.history[0];
    this.src = null; // decoded original (ImageBitmap or canvas)
    this.oriented = null; // canvas after rotate/flip
    this.orientedKey = '';
    this.adjusted = null; // canvas after the adjustments
    this.adjustedKey = '';
    this.preview = null; // small adjusted copy while dragging a slider
    this.zoom = 1;
    this.fitted = true;
    this.selected = -1;
    this.drag = null;
    this.cropping = null;
    this.typing = null;
    this.busy = false;
    this.closing = false;
    this.loadToken = 0;
    this.cache = new Map(); // preloaded neighbours: path -> Promise<ArrayBuffer>
    this.panel = null; // 'adjust' | 'settings' | null
    this.pointers = new Map();
    this.renderQueued = false;
  }

  // ---------- layout ----------
  onOpen() {
    this.modalEl.classList.add('pmp-modal');
    this.containerEl.classList.add('pmp-container');
    this.contentEl.classList.add('pmp-content');
    // the editor has its own close button next to Save; Obsidian's own one would overlap it
    this.modalEl.querySelectorAll('.modal-close-button').forEach((b) => b.remove());
    this.buildUi();
    this.registerKeys();
    this.onResize = () => { if (this.fitted) this.fit(); else this.layoutCanvas(); if (this.toolbarEdges) this.toolbarEdges(); };
    window.addEventListener('resize', this.onResize);
    this.load(this.file);
  }

  buildUi() {
    const c = this.contentEl;
    c.replaceChildren();
    c.classList.toggle('pmp-labels', !!this.s.showLabels);

    // top: browse + title, actions
    const top = el('div', 'pmp-top');
    const nav = el('div', 'pmp-nav');
    this.btnPrev = iconButton(nav, 'chevron-left', t('previous'), `${t('previous')} (←)`, 'pmp-icon-only');
    const title = el('div', 'pmp-title');
    this.nameEl = el('span', 'pmp-filename', this.file.name);
    this.counterEl = el('span', 'pmp-counter');
    title.append(this.nameEl, this.counterEl);
    nav.append(title);
    this.btnNext = iconButton(nav, 'chevron-right', t('next'), `${t('next')} (→)`, 'pmp-icon-only');
    this.btnPrev.addEventListener('click', () => this.go(this.index - 1));
    this.btnNext.addEventListener('click', () => this.go(this.index + 1));
    const actions = el('div', 'pmp-actions');
    this.btnUndo = iconButton(actions, 'undo-2', t('undo'), `${t('undo')} (Ctrl/Cmd+Z)`, 'pmp-icon-only');
    this.btnRedo = iconButton(actions, 'redo-2', t('redo'), `${t('redo')} (Ctrl/Cmd+Shift+Z)`, 'pmp-icon-only');
    this.btnAdjust = iconButton(actions, 'sliders-horizontal', t('adjust'), t('adjust'), 'pmp-toggle');
    this.btnSettings = iconButton(actions, 'settings', t('settings'), t('settings'), 'pmp-toggle pmp-icon-only');
    this.btnDelete = iconButton(actions, 'trash-2', t('deleteImage'), t('deleteImage'), 'pmp-icon-only pmp-danger');
    this.btnClose = iconButton(actions, 'x', t('close'), `${t('close')} (Esc)`, 'pmp-icon-only');
    this.btnSave = iconButton(actions, 'check', t('save'), `${t('save')} (Ctrl/Cmd+S)`, 'pmp-save mod-cta');
    this.btnUndo.addEventListener('click', () => this.undo());
    this.btnRedo.addEventListener('click', () => this.redo());
    this.btnAdjust.addEventListener('click', () => this.togglePanel('adjust'));
    this.btnSettings.addEventListener('click', () => this.togglePanel('settings'));
    this.btnDelete.addEventListener('click', () => this.deleteImage());
    this.btnClose.addEventListener('click', () => this.close());
    this.btnSave.addEventListener('click', () => this.save(this.s.afterSave));
    top.append(nav, actions);

    // tools + rotate/flip + zoom
    const bar = el('div', 'pmp-toolbar');
    const tools = el('div', 'pmp-tools');
    this.toolButtons = {};
    for (const tool of TOOLS) {
      const b = iconButton(tools, tool.icon, t(tool.id), `${t(tool.id)} (${tool.key})`, 'pmp-tool');
      b.dataset.tool = tool.id;
      b.addEventListener('click', () => this.setTool(tool.id));
      this.toolButtons[tool.id] = b;
    }
    const geo = el('div', 'pmp-group');
    iconButton(geo, 'rotate-ccw', t('rotateLeft'), `${t('rotateLeft')} ([)`, 'pmp-icon-only').addEventListener('click', () => this.transform('ccw'));
    iconButton(geo, 'rotate-cw', t('rotateRight'), `${t('rotateRight')} (])`, 'pmp-icon-only').addEventListener('click', () => this.transform('cw'));
    iconButton(geo, 'flip-horizontal', t('flipH'), t('flipH'), 'pmp-icon-only').addEventListener('click', () => this.transform('flipH'));
    iconButton(geo, 'flip-vertical', t('flipV'), t('flipV'), 'pmp-icon-only').addEventListener('click', () => this.transform('flipV'));
    const zoom = el('div', 'pmp-group pmp-zoom');
    iconButton(zoom, 'zoom-out', t('zoomOut'), `${t('zoomOut')} (-)`, 'pmp-icon-only').addEventListener('click', () => this.zoomBy(1 / 1.25));
    this.zoomLabel = el('button', 'pmp-btn pmp-zoom-label', '100%');
    this.zoomLabel.type = 'button';
    this.zoomLabel.title = `${t('zoomFit')} (0) / ${t('zoom100')} (1)`;
    this.zoomLabel.addEventListener('click', () => (this.fitted ? this.setZoom(1) : this.fit()));
    zoom.append(this.zoomLabel);
    iconButton(zoom, 'zoom-in', t('zoomIn'), `${t('zoomIn')} (+)`, 'pmp-icon-only').addEventListener('click', () => this.zoomBy(1.25));
    bar.append(tools, geo, zoom);
    // narrow screens: the toolbar scrolls sideways; show on which side there is more
    const edges = () => {
      bar.classList.toggle('pmp-more-left', bar.scrollLeft > 2);
      bar.classList.toggle('pmp-more-right', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
    };
    bar.addEventListener('scroll', edges, { passive: true });
    this.toolbarEdges = edges;

    // options of the current tool
    this.optionsEl = el('div', 'pmp-options');

    // stage with the canvas, side panel
    const main = el('div', 'pmp-main');
    this.stage = el('div', 'pmp-stage');
    this.wrap = el('div', 'pmp-wrap');
    this.box = el('div', 'pmp-box');
    this.canvas = el('canvas', 'pmp-canvas');
    this.overlay = el('div', 'pmp-overlay');
    this.box.append(this.canvas, this.overlay);
    this.wrap.append(this.box);
    this.status = el('div', 'pmp-status', t('loading'));
    this.stage.append(this.wrap, this.status);
    this.panelEl = el('div', 'pmp-panel');
    main.append(this.stage, this.panelEl);
    this.ctx = this.canvas.getContext('2d');

    this.film = el('div', 'pmp-film');
    this.foot = el('div', 'pmp-foot');
    this.hintEl = el('span', 'pmp-hint');
    this.infoEl = el('span', 'pmp-info');
    this.foot.append(this.hintEl, this.infoEl);

    c.append(top, bar, this.optionsEl, main, this.film, this.foot);
    this.attachPointer();
    this.stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.setTool(this.tool, true);
    this.renderFilm();
    this.renderPanel();
    this.updateButtons();
    window.requestAnimationFrame(() => this.toolbarEdges());
  }

  // keyboard: our own listener (capture), only while the editor is the top modal; Esc is left to Obsidian's modal
  registerKeys() {
    this.onKeyDown = (e) => {
      if (e.defaultPrevented || e.isComposing || !this.isTop()) return;
      if (e.code === 'Space' && !isTyping()) {
        this.space = true;
        this.stage.classList.add('pmp-panning');
        if (e.target === document.body || this.contentEl.contains(e.target)) e.preventDefault(); // no page scroll, no button press
        return;
      }
      if (isTyping() || this.busy || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let done = true;
      if (mod) {
        if (k === 's') this.save(this.s.afterSave);
        else if ((k === 'z' && e.shiftKey) || k === 'y') this.redo();
        else if (k === 'z') this.undo();
        else done = false;
      } else if (k === 'Enter') {
        if (this.cropping) this.applyCrop(); else this.save(this.s.afterSave);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (onSlider()) done = false;
        else this.go(this.index + (k === 'ArrowLeft' ? -1 : 1));
      } else if (k === 'Delete' || k === 'Backspace') {
        if (this.selected >= 0) this.removeSelected(); else done = false;
      } else if (k === '[') this.transform('ccw');
      else if (k === ']') this.transform('cw');
      else if (k === '+' || k === '=') this.zoomBy(1.25);
      else if (k === '-') this.zoomBy(1 / 1.25);
      else if (k === '0') this.fit();
      else if (k === '1') this.setZoom(1);
      else {
        const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
        if (tool) this.setTool(tool.id); else done = false;
      }
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };
    this.onKeyUp = (e) => { if (e.code === 'Space') { this.space = false; this.stage.classList.remove('pmp-panning'); } };
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  // no dialog (ours or another plugin's) on top of the editor
  isTop() {
    const all = document.querySelectorAll('.modal-container');
    return all.length > 0 && all[all.length - 1] === this.containerEl;
  }

  // ---------- loading ----------
  readFile(file) {
    if (!this.cache.has(file.path)) this.cache.set(file.path, this.app.vault.readBinary(file));
    return this.cache.get(file.path);
  }

  preload() {
    const keep = new Set();
    for (const i of [this.index - 1, this.index + 1]) {
      const f = this.gallery[i];
      if (f) { keep.add(f.path); this.readFile(f).catch(() => this.cache.delete(f.path)); }
    }
    for (const p of [...this.cache.keys()]) if (!keep.has(p) && p !== this.file.path) this.cache.delete(p);
  }

  async decode(data, ext) {
    const blob = new Blob([data], { type: mimeOf(ext) });
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (e) { /* fall back to <img> */ }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('decode')); img.src = url; });
      const c = canvasOf(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }

  async load(file) {
    const token = ++this.loadToken;
    this.file = file;
    this.index = Math.max(0, this.gallery.indexOf(file));
    this.nameEl.textContent = file.name;
    this.status.textContent = t('loading');
    this.status.classList.remove('pmp-error');
    this.box.classList.add('pmp-hidden');
    this.ready = false;
    this.updateButtons();
    this.renderFilm();
    try {
      const data = await this.readFile(file);
      if (token !== this.loadToken) return;
      const bmp = await this.decode(data, file.extension);
      if (token !== this.loadToken) return;
      if (bmp.width * bmp.height > MAX_PIXELS) { this.status.textContent = t('tooLarge'); this.status.classList.add('pmp-error'); return; }
      this.startWith(bmp);
      this.status.textContent = '';
      this.box.classList.remove('pmp-hidden');
      this.preload();
    } catch (e) {
      if (token !== this.loadToken) return;
      this.status.textContent = t('loadFailed');
      this.status.classList.add('pmp-error');
    }
  }

  // a fresh start with a decoded image (after loading, and after saving)
  startWith(bmp) {
    if (this.src && this.src.close && this.src !== bmp) this.src.close();
    this.src = bmp;
    this.state = freshState();
    this.history = [snapshot(this.state)];
    this.hIndex = 0;
    this.baseline = this.history[0];
    this.selected = -1;
    this.cropping = null;
    this.endTyping(false);
    this.orientedKey = '';
    this.adjustedKey = '';
    this.preview = null;
    const big = Math.max(bmp.width, bmp.height);
    this.autoWidth = Math.max(3, Math.round(big / 280));
    this.autoFont = Math.max(14, Math.round(big / 38));
    this.ready = true;
    this.refreshImage();
    this.renderOptions();
    this.renderPanel();
    this.fit();
  }

  // ---------- image pipeline ----------
  get W() { return this.oriented ? this.oriented.width : 0; }
  get H() { return this.oriented ? this.oriented.height : 0; }

  refreshImage(fullAdjust) {
    const st = this.state;
    const oKey = `${st.rot}|${st.flip}`;
    if (oKey !== this.orientedKey) {
      this.oriented = orient(this.src, st.rot, st.flip);
      this.orientedKey = oKey;
      this.adjustedKey = '';
    }
    const aKey = `${oKey}|${JSON.stringify(st.adj)}`;
    if (aKey !== this.adjustedKey || fullAdjust) {
      this.adjusted = isNeutral(st.adj) ? this.oriented : adjust(this.oriented, st.adj);
      this.adjustedKey = aKey;
      this.preview = null;
    }
  }

  // while a slider moves: a small adjusted copy for speed; the full one follows on release
  previewAdjust() {
    if (this.previewQueued) return;
    this.previewQueued = true;
    requestAnimationFrame(() => {
      this.previewQueued = false;
      const big = Math.max(this.W, this.H);
      const scale = Math.min(1, 1200 / big);
      if (scale >= 1) { this.refreshImage(); this.render(); return; }
      this.preview = isNeutral(this.state.adj) ? null : adjust(this.oriented, this.state.adj, scale);
      this.render();
    });
  }

  cropRect() {
    const c = this.state.crop;
    return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : { x: 0, y: 0, w: this.W, h: this.H };
  }

  // the rectangle of the oriented image that the canvas shows
  view() { return this.cropping ? { x: 0, y: 0, w: this.W, h: this.H } : this.cropRect(); }

  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
  }

  render() {
    if (!this.ready || !this.oriented) return;
    const v = this.view();
    const c = this.canvas;
    if (c.width !== v.w || c.height !== v.h) {
      c.width = v.w;
      c.height = v.h;
      this.layoutCanvas();
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const base = this.preview || this.adjusted;
    const k = base.width / this.W;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, v.x * k, v.y * k, v.w * k, v.h * k, 0, 0, v.w, v.h);
    ctx.setTransform(1, 0, 0, 1, -v.x, -v.y);
    let n = 0;
    const marks = this.drag && this.drag.mark && this.drag.kind === 'draw' ? [...this.state.marks, this.drag.mark] : this.state.marks;
    for (const m of marks) {
      if (m.tool === 'number') n++;
      if (this.typing && this.typing.index !== undefined && marks.indexOf(m) === this.typing.index) continue; // shown in the text box
      drawMark(ctx, m, n, v.x, v.y);
    }
    // selection (only on screen, never saved)
    const sel = this.state.marks[this.selected];
    if (sel && !this.cropping) {
      const b = boxOf(sel);
      const px = Math.max(1, c.width / Math.max(1, this.canvas.getBoundingClientRect().width));
      ctx.save();
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.w + 8 * px, b.h + 8 * px);
      ctx.lineDashOffset = 5 * px;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.w + 8 * px, b.h + 8 * px);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.cropping) this.renderCropBox();
    this.updateInfo();
  }

  // the final image: crop, marks and size, without anything that is only on screen
  exportCanvas(mime) {
    this.refreshImage(this.preview != null);
    const r = this.cropRect();
    let out = canvasOf(r.w, r.h);
    const ctx = out.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, r.w, r.h); }
    ctx.drawImage(this.adjusted, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    ctx.setTransform(1, 0, 0, 1, -r.x, -r.y);
    let n = 0;
    for (const m of this.state.marks) {
      if (m.tool === 'number') n++;
      drawMark(ctx, m, n, r.x, r.y);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const size = this.state.size || 100;
    if (size !== 100) {
      const w = Math.max(1, Math.round((r.w * size) / 100)), h = Math.max(1, Math.round((r.h * size) / 100));
      const small = canvasOf(w, h);
      const sc = small.getContext('2d');
      if (mime === 'image/jpeg') { sc.fillStyle = '#ffffff'; sc.fillRect(0, 0, w, h); }
      sc.imageSmoothingEnabled = true;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(out, 0, 0, w, h);
      out = small;
    }
    return out;
  }

  // ---------- zoom ----------
  layoutCanvas() {
    const w = Math.max(1, Math.round(this.canvas.width * this.zoom)), h = Math.max(1, Math.round(this.canvas.height * this.zoom));
    this.box.style.width = `${w}px`;
    this.box.style.height = `${h}px`;
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    if (this.typing) this.placeTextBox();
  }

  fitZoom() {
    const v = this.view();
    const cs = window.getComputedStyle(this.wrap);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const w = this.stage.clientWidth - padX, h = this.stage.clientHeight - padY;
    if (w <= 0 || h <= 0 || !v.w) return 1;
    return Math.min(w / v.w, h / v.h, 3);
  }

  fit() {
    if (!this.ready) return;
    this.fitted = true;
    this.zoom = this.fitZoom();
    this.render();
    this.layoutCanvas();
  }

  // where a screen point lies on the image, as a fraction of the shown canvas
  fracAt(x, y) {
    const r = this.canvas.getBoundingClientRect();
    return { fx: (x - r.left) / Math.max(1, r.width), fy: (y - r.top) / Math.max(1, r.height) };
  }

  // scroll so that image point f is under screen point (x, y); exact, also while the image is centered
  keepAt(f, x, y) {
    const r = this.canvas.getBoundingClientRect();
    this.stage.scrollLeft += r.left + f.fx * r.width - x;
    this.stage.scrollTop += r.top + f.fy * r.height - y;
  }

  // at = screen point (clientX/Y) that stays in place; default the middle of the stage
  setZoom(z, at, frac) {
    if (!this.ready) return;
    const sr = this.stage.getBoundingClientRect();
    const p = at || { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    const f = frac || this.fracAt(p.x, p.y);
    this.zoom = clamp(z, 0.05, 16);
    this.fitted = false;
    this.layoutCanvas();
    this.keepAt(f, p.x, p.y);
  }

  zoomBy(f, at) { this.setZoom(this.zoom * f, at); }

  // Ctrl/Cmd + wheel and trackpad pinch zoom; a mouse wheel zooms too; trackpad scrolling pans
  onWheel(e) {
    if (!this.ready) return;
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (!(e.ctrlKey || e.metaKey) && !mouseWheel) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    // small steps (trackpad pinch) need a higher rate than the 100-pixel notches of a mouse wheel
    const rate = Math.abs(dy) < 40 ? 0.01 : 0.0022;
    // during one series of wheel steps keep aiming at the same image point: while the image is still
    // smaller than the window it stays centered, and the point comes back under the pointer once it can
    const now = Date.now(), a = this.wheelAnchor;
    const same = a && now - a.t < 400 && Math.abs(a.x - e.clientX) < 4 && Math.abs(a.y - e.clientY) < 4;
    const f = same ? a.f : this.fracAt(e.clientX, e.clientY);
    this.wheelAnchor = { f, x: e.clientX, y: e.clientY, t: now };
    this.setZoom(this.zoom * Math.exp(-clamp(dy, -300, 300) * rate), { x: e.clientX, y: e.clientY }, f);
  }

  // ---------- tools and options ----------
  setTool(id, quiet) {
    if (!TOOL_IDS.includes(id)) return;
    if (this.cropping && id !== 'crop') this.applyCrop();
    this.endTyping(true);
    this.tool = id;
    for (const [k, b] of Object.entries(this.toolButtons)) b.classList.toggle('is-active', k === id);
    if (id !== 'select') this.selected = -1;
    if (id === 'crop' && this.ready) this.startCrop();
    this.stage.classList.toggle('pmp-draw', id !== 'select');
    this.hintEl.textContent = t(`hint_${id}`);
    if (!quiet && id !== 'crop' && this.s.tool !== id) { this.s.tool = id; this.plugin.saveSettings(); }
    this.renderOptions();
    this.requestRender();
  }

  colorFor(tool) {
    if (tool === 'block') return this.s.blockColor;
    if (tool === 'highlighter') return this.s.highlightColor;
    return this.s.color;
  }
  colorKey(tool) { return tool === 'block' ? 'blockColor' : tool === 'highlighter' ? 'highlightColor' : 'color'; }
  widthFor(tool) {
    const w = this.s.lineWidth > 0 ? this.s.lineWidth : this.autoWidth || 4;
    return tool === 'highlighter' ? w * 4 : w;
  }
  fontFor() { return this.s.fontSize > 0 ? this.s.fontSize : this.autoFont || 32; }

  renderOptions() {
    const o = this.optionsEl;
    o.replaceChildren();
    if (this.tool === 'crop') {
      const aspects = el('div', 'pmp-group');
      for (const [id, ratio] of ASPECTS) {
        const b = el('button', 'pmp-btn pmp-chip', id === 'free' ? t('free') : id === 'original' ? t('original') : id);
        b.type = 'button';
        b.classList.toggle('is-active', !!this.cropping && this.cropping.aspect === id);
        b.addEventListener('click', () => this.setAspect(id, ratio));
        aspects.append(b);
      }
      const acts = el('div', 'pmp-group');
      const full = el('button', 'pmp-btn', t('fullImage'));
      full.type = 'button';
      full.addEventListener('click', () => { if (this.cropping) { this.cropping.rect = { x: 0, y: 0, w: this.W, h: this.H }; this.render(); } });
      const cancel = el('button', 'pmp-btn', t('cancel'));
      cancel.type = 'button';
      cancel.addEventListener('click', () => this.cancelCrop());
      const apply = el('button', 'pmp-btn mod-cta pmp-apply', t('apply'));
      apply.type = 'button';
      apply.addEventListener('click', () => this.applyCrop());
      acts.append(full, cancel, apply);
      o.append(aspects, acts);
      return;
    }
    const sel = this.state.marks[this.selected];
    const tool = sel ? sel.tool : this.tool;
    if (this.tool === 'select' && !sel) {
      const clear = el('button', 'pmp-btn', t('clearMarks'));
      clear.type = 'button';
      clear.disabled = !this.state.marks.length;
      clear.addEventListener('click', () => { if (this.state.marks.length) { this.state.marks = []; this.selected = -1; this.commit(); } });
      o.append(clear);
      return;
    }
    if (tool === 'pixelate' || tool === 'blur') return;
    // colors
    const colors = el('div', 'pmp-group pmp-swatches');
    const current = sel ? sel.color : this.colorFor(tool);
    for (const sw of SWATCHES) {
      const b = el('button', 'pmp-swatch');
      b.type = 'button';
      b.style.setProperty('--pmp-swatch', sw);
      b.title = sw;
      b.setAttribute('aria-label', `${t('color')} ${sw}`);
      b.classList.toggle('is-active', sw.toLowerCase() === String(current).toLowerCase());
      b.addEventListener('click', () => this.setColor(sw));
      colors.append(b);
    }
    const pick = el('input', 'pmp-color');
    pick.type = 'color';
    pick.value = current;
    pick.classList.toggle('is-active', !SWATCHES.some((sw) => sw.toLowerCase() === String(current).toLowerCase()));
    pick.title = t('color');
    pick.setAttribute('aria-label', t('color'));
    pick.addEventListener('input', () => this.setColor(pick.value, true));
    pick.addEventListener('change', () => this.setColor(pick.value));
    colors.append(pick);
    o.append(colors);
    // width or text size
    if (tool === 'text') {
      const g = el('label', 'pmp-group pmp-range');
      g.append(el('span', '', t('fontSize')));
      const r = el('input');
      r.type = 'range';
      r.min = '8';
      r.max = '240';
      r.value = String(sel ? sel.size : this.fontFor());
      r.addEventListener('input', () => {
        if (sel) { sel.size = +r.value; delete sel._box; this.requestRender(); } else { this.s.fontSize = +r.value; if (this.typing) this.placeTextBox(); }
      });
      r.addEventListener('change', () => { if (sel) this.commit(); else this.plugin.saveSettings(); });
      g.append(r);
      const bg = el('label', 'pmp-group pmp-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = sel ? !!sel.bg : !!this.s.textBackground;
      box.addEventListener('change', () => {
        if (sel) { sel.bg = box.checked; delete sel._box; this.commit(); } else { this.s.textBackground = box.checked; this.plugin.saveSettings(); if (this.typing) this.placeTextBox(); }
      });
      bg.append(box, el('span', '', t('textBg')));
      o.append(g, bg);
    } else if (tool !== 'block') {
      const g = el('label', 'pmp-group pmp-range');
      g.append(el('span', '', t('width')));
      const r = el('input');
      r.type = 'range';
      r.min = '1';
      r.max = '40';
      const base = sel ? (sel.tool === 'highlighter' ? sel.width / 4 : sel.width) : this.widthFor('pen');
      r.value = String(Math.round(base));
      const auto = el('button', 'pmp-btn pmp-chip', t('auto'));
      auto.type = 'button';
      auto.classList.toggle('is-active', !sel && !(this.s.lineWidth > 0));
      auto.addEventListener('click', () => { this.s.lineWidth = 0; this.plugin.saveSettings(); this.renderOptions(); });
      r.addEventListener('input', () => {
        if (sel) { sel.width = sel.tool === 'highlighter' ? +r.value * 4 : +r.value; delete sel._box; this.requestRender(); } else { this.s.lineWidth = +r.value; auto.classList.remove('is-active'); }
      });
      r.addEventListener('change', () => { if (sel) this.commit(); else this.plugin.saveSettings(); });
      g.append(r);
      o.append(g);
      if (!sel) o.append(auto);
    }
  }

  setColor(color, live) {
    const sel = this.state.marks[this.selected];
    if (sel) {
      sel.color = color;
      if (live) this.requestRender(); else this.commit();
    } else {
      this.s[this.colorKey(this.tool)] = color;
      if (!live) this.plugin.saveSettings();
      if (this.typing) this.typing.input.style.color = color;
    }
    if (!live) this.renderOptions();
  }

  // ---------- undo / redo ----------
  commit() {
    const snap = snapshot(this.state);
    if (snap === this.history[this.hIndex]) { this.render(); this.updateButtons(); return; }
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push(snap);
    if (this.history.length > 150) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.render();
    this.updateButtons();
  }

  restore(i) {
    if (i < 0 || i >= this.history.length || this.busy || !this.ready) return;
    this.endTyping(false);
    if (this.cropping) this.cancelCrop(true);
    const before = this.state;
    this.hIndex = i;
    this.state = JSON.parse(this.history[i]);
    this.selected = -1;
    this.refreshImage();
    const dims = before.rot !== this.state.rot || JSON.stringify(before.crop) !== JSON.stringify(this.state.crop);
    if (dims && this.fitted) this.fit(); else this.render();
    this.renderOptions();
    this.renderPanel();
    this.updateButtons();
  }

  undo() { this.restore(this.hIndex - 1); }
  redo() { this.restore(this.hIndex + 1); }
  get dirty() { return this.ready && snapshot(this.state) !== this.baseline; }
  // a change that is not in the history yet: text being typed, a crop frame being dragged
  get pending() {
    if (this.typing) return !!this.typing.input.value.trim();
    if (!this.cropping) return false;
    const a = this.cropping.rect, b = this.cropRect();
    return Math.round(a.x) !== b.x || Math.round(a.y) !== b.y || Math.round(a.w) !== b.w || Math.round(a.h) !== b.h;
  }

  updateButtons() {
    const ready = this.ready && !this.busy;
    this.btnUndo.disabled = !ready || this.hIndex === 0;
    this.btnRedo.disabled = !ready || this.hIndex >= this.history.length - 1;
    this.btnSave.disabled = !ready || !(this.dirty || this.pending);
    this.btnDelete.disabled = this.busy;
    this.btnPrev.disabled = this.busy || this.index <= 0;
    this.btnNext.disabled = this.busy || this.index >= this.gallery.length - 1;
    const many = this.gallery.length > 1;
    this.btnPrev.classList.toggle('pmp-hidden', !many);
    this.btnNext.classList.toggle('pmp-hidden', !many);
    this.counterEl.textContent = many ? t('counter', this.index + 1, this.gallery.length) : '';
    this.btnAdjust.classList.toggle('is-active', this.panel === 'adjust');
    this.btnSettings.classList.toggle('is-active', this.panel === 'settings');
    this.contentEl.classList.toggle('pmp-busy', this.busy);
    this.updateInfo();
  }

  updateInfo() {
    if (!this.infoEl || !this.ready) return;
    const r = this.cropRect(), size = this.state.size || 100;
    const w = Math.round((r.w * size) / 100), h = Math.round((r.h * size) / 100);
    this.infoEl.textContent = `${t('sizeInfo', w, h)}${this.dirty ? ` · ${t('unsaved')}` : ''}`;
  }

  // ---------- rotate and flip ----------
  transform(op) {
    if (!this.ready || this.busy) return;
    if (this.cropping) this.applyCrop();
    this.endTyping(true);
    const W = this.W, H = this.H, st = this.state;
    let fn;
    if (op === 'cw') { fn = ([x, y]) => [H - y, x]; st.rot = (st.rot + 90) % 360; }
    else if (op === 'ccw') { fn = ([x, y]) => [y, W - x]; st.rot = (st.rot + 270) % 360; }
    else if (op === 'flipH') { fn = ([x, y]) => [W - x, y]; st.rot = (360 - st.rot) % 360; st.flip = !st.flip; }
    else if (op === 'flipV') { fn = ([x, y]) => [x, H - y]; st.rot = (540 - st.rot) % 360; st.flip = !st.flip; }
    else return;
    for (const m of st.marks) mapMark(m, fn);
    if (st.crop) {
      const [ax, ay] = fn([st.crop.x, st.crop.y]), [bx, by] = fn([st.crop.x + st.crop.w, st.crop.y + st.crop.h]);
      st.crop = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    }
    this.refreshImage();
    this.commit();
    if (this.fitted) this.fit();
  }

  // ---------- crop ----------
  startCrop() {
    this.cropping = { rect: this.cropRect(), aspect: 'free', ratio: null, before: this.state.crop };
    if (this.fitted) this.fit(); else this.render();
  }

  setAspect(id, ratio) {
    if (!this.cropping) return;
    const r = ratio === 'original' ? this.W / this.H : ratio;
    this.cropping.aspect = id;
    this.cropping.ratio = r;
    if (r) {
      const c = this.cropping.rect;
      let w = c.w, h = c.w / r;
      if (h > c.h) { h = c.h; w = h * r; }
      this.cropping.rect = { x: Math.round(c.x + (c.w - w) / 2), y: Math.round(c.y + (c.h - h) / 2), w: Math.round(w), h: Math.round(h) };
    }
    this.renderOptions();
    this.render();
  }

  applyCrop() {
    if (!this.cropping) return;
    const r = this.cropping.rect;
    const full = r.x <= 0 && r.y <= 0 && r.w >= this.W && r.h >= this.H;
    this.state.crop = full ? null : { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    this.cropping = null;
    this.overlay.replaceChildren();
    if (this.tool === 'crop') this.setTool('rect');
    this.commit();
    if (this.fitted) this.fit();
  }

  cancelCrop(quiet) {
    if (!this.cropping) return;
    this.cropping = null;
    this.overlay.replaceChildren();
    if (!quiet) {
      if (this.tool === 'crop') this.setTool('rect');
      if (this.fitted) this.fit(); else this.render();
    }
  }

  renderCropBox() {
    const r = this.cropping.rect;
    let box = this.overlay.querySelector('.pmp-crop');
    if (!box) {
      box = el('div', 'pmp-crop');
      for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const d = el('div', `pmp-handle pmp-h-${h}`);
        d.dataset.handle = h;
        box.append(d);
      }
      for (const g of ['pmp-grid-v1', 'pmp-grid-v2', 'pmp-grid-h1', 'pmp-grid-h2']) box.append(el('div', `pmp-grid ${g}`));
      this.overlay.append(box);
    }
    box.style.left = `${(r.x / this.W) * 100}%`;
    box.style.top = `${(r.y / this.H) * 100}%`;
    box.style.width = `${(r.w / this.W) * 100}%`;
    box.style.height = `${(r.h / this.H) * 100}%`;
  }

  dragCrop(start, p, handle) {
    const c = this.cropping, s = start.rect, ratio = c.ratio, W = this.W, H = this.H;
    const dx = p.x - start.p.x, dy = p.y - start.p.y;
    let { x, y, w, h } = s;
    if (handle === 'move') {
      x = clamp(s.x + dx, 0, W - s.w); y = clamp(s.y + dy, 0, H - s.h);
    } else if (handle === 'new') {
      x = Math.min(start.p.x, p.x); y = Math.min(start.p.y, p.y); w = Math.abs(dx); h = Math.abs(dy);
      if (ratio) { h = w / ratio; if (p.y < start.p.y) y = start.p.y - h; }
    } else {
      if (handle.includes('w')) { x = clamp(s.x + dx, 0, s.x + s.w - 8); w = s.x + s.w - x; }
      if (handle.includes('e')) { w = clamp(s.w + dx, 8, W - s.x); }
      if (handle.includes('n')) { y = clamp(s.y + dy, 0, s.y + s.h - 8); h = s.y + s.h - y; }
      if (handle.includes('s')) { h = clamp(s.h + dy, 8, H - s.y); }
      if (ratio) {
        if (handle === 'n' || handle === 's') { const nw = h * ratio; x = s.x + (s.w - nw) / 2; w = nw; }
        else { const nh = w / ratio; if (handle.includes('n')) y = s.y + s.h - nh; else if (!handle.includes('s')) y = s.y + (s.h - nh) / 2; h = nh; }
      }
    }
    // keep inside the image
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    w = Math.min(w, W - x); h = Math.min(h, H - y);
    c.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    this.requestRender();
    this.updateButtons();
  }

  // ---------- text ----------
  startTyping(p, index) {
    const existing = index !== undefined ? this.state.marks[index] : null;
    const input = el('textarea', 'pmp-textbox');
    input.rows = 1;
    input.spellcheck = false;
    input.value = existing ? existing.text : '';
    this.typing = { x: existing ? existing.x : p.x, y: existing ? existing.y : p.y, index: existing ? index : undefined, input };
    this.overlay.append(input);
    this.placeTextBox();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); this.endTyping(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endTyping(false); }
      e.stopPropagation();
    });
    input.addEventListener('input', () => { this.placeTextBox(); this.updateButtons(); });
    input.addEventListener('blur', () => window.setTimeout(() => { if (this.typing && this.typing.input === input) this.endTyping(true); }, 0));
    window.setTimeout(() => input.focus(), 0);
    this.render();
  }

  placeTextBox() {
    const tp = this.typing;
    if (!tp) return;
    const v = this.view();
    const m = tp.index !== undefined ? this.state.marks[tp.index] : null;
    const size = m ? m.size : this.fontFor();
    const scale = this.box.clientWidth / Math.max(1, v.w);
    const i = tp.input;
    i.style.left = `${((tp.x - v.x) / v.w) * 100}%`;
    i.style.top = `${((tp.y - v.y) / v.h) * 100}%`;
    i.style.fontSize = `${size * scale}px`;
    i.style.color = m ? m.color : this.colorFor('text');
    const lines = i.value.split('\n');
    i.style.width = `${Math.max(4, ...lines.map((l) => l.length + 2))}ch`;
    i.style.height = `${lines.length * 1.3 + 0.4}em`;
  }

  endTyping(keep) {
    const tp = this.typing;
    if (!tp) return;
    this.typing = null;
    const text = tp.input.value.replace(/\s+$/, '');
    tp.input.remove();
    if (tp.index !== undefined) {
      const m = this.state.marks[tp.index];
      if (keep && m) {
        if (text) m.text = text; else this.state.marks.splice(tp.index, 1);
        delete m._box;
        this.commit();
      } else this.render();
      return;
    }
    if (keep && text) {
      this.state.marks.push({ tool: 'text', color: this.colorFor('text'), size: this.fontFor(), bg: !!this.s.textBackground, x: tp.x, y: tp.y, text });
      this.commit();
    } else this.render();
  }

  // ---------- pointer ----------
  point(e) {
    const r = this.canvas.getBoundingClientRect(), v = this.view();
    return { x: ((e.clientX - r.left) / r.width) * v.w + v.x, y: ((e.clientY - r.top) / r.height) * v.h + v.y };
  }

  attachPointer() {
    const st = this.stage;
    st.addEventListener('pointerdown', (e) => this.onDown(e));
    st.addEventListener('pointermove', (e) => this.onMove(e));
    st.addEventListener('pointerup', (e) => this.onUp(e));
    st.addEventListener('pointercancel', (e) => this.onUp(e, true));
    st.addEventListener('dblclick', (e) => { if (this.cropping) { e.preventDefault(); this.applyCrop(); } });
  }

  onDown(e) {
    if (!this.ready || this.busy) return;
    if (e.target === this.status || (e.target.closest && e.target.closest('.pmp-textbox'))) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && this.contentEl.contains(focused) && focused.blur) focused.blur();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { // two fingers: pinch to zoom and pan
      const st = this.pinchState();
      st.f = this.fracAt(st.cx, st.cy);
      this.drag = { kind: 'pinch', start: st };
      return;
    }
    if (this.pointers.size > 2) return;
    try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    if (e.button === 1 || this.space) {
      e.preventDefault();
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: this.stage.scrollLeft, st: this.stage.scrollTop };
      return;
    }
    if (e.button && e.button !== 0) return;
    const p = this.point(e);
    const inside = p.x >= 0 && p.y >= 0 && p.x <= this.W && p.y <= this.H;
    if (this.cropping) {
      const handle = e.target.dataset && e.target.dataset.handle ? e.target.dataset.handle : e.target.closest && e.target.closest('.pmp-crop') ? 'move' : 'new';
      e.preventDefault();
      this.drag = { kind: 'crop', handle, start: { p, rect: Object.assign({}, this.cropping.rect) } };
      return;
    }
    if (this.typing) { this.endTyping(true); return; }
    if (!inside) {
      if (this.tool === 'select' && this.selected >= 0) { this.selected = -1; this.renderOptions(); this.render(); }
      return;
    }
    e.preventDefault();
    const tol = 6 * (this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width));
    if (this.tool === 'select') {
      let hit = -1;
      for (let i = this.state.marks.length - 1; i >= 0; i--) if (hits(this.state.marks[i], p.x, p.y, tol)) { hit = i; break; }
      this.selected = hit;
      this.renderOptions();
      if (hit >= 0) this.drag = { kind: 'move', p, moved: false };
      this.render();
      return;
    }
    if (this.tool === 'text') {
      let hit;
      for (let i = this.state.marks.length - 1; i >= 0; i--) {
        const m = this.state.marks[i];
        if (m.tool === 'text' && hits(m, p.x, p.y, tol)) { hit = i; break; }
      }
      this.startTyping(p, hit);
      return;
    }
    if (this.tool === 'number') {
      this.state.marks.push({ tool: 'number', color: this.colorFor('number'), width: this.widthFor('number'), x: p.x, y: p.y });
      this.commit();
      return;
    }
    const base = { tool: this.tool, color: this.colorFor(this.tool), width: this.widthFor(this.tool) };
    if (this.tool === 'pixelate' || this.tool === 'blur') base.cell = cellSize(this.tool, this.W, this.H);
    const mark = STROKES.has(this.tool) ? Object.assign(base, { points: [[p.x, p.y]] }) : Object.assign(base, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    this.drag = { kind: 'draw', mark, p };
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      // the image point that was under the fingers stays under them: zoom and pan in one gesture
      const now = this.pinchState(), s = d.start;
      this.zoom = clamp(s.zoom * (now.dist / Math.max(1, s.dist)), 0.05, 16);
      this.fitted = false;
      this.layoutCanvas();
      this.keepAt(s.f, now.cx, now.cy);
      return;
    }
    if (d.kind === 'pan') {
      this.stage.scrollLeft = d.sl - (e.clientX - d.x);
      this.stage.scrollTop = d.st - (e.clientY - d.y);
      return;
    }
    const p = this.point(e);
    if (d.kind === 'crop') { this.dragCrop(d.start, p, d.handle); return; }
    if (d.kind === 'move') {
      const m = this.state.marks[this.selected];
      if (!m) return;
      moveMark(m, p.x - d.p.x, p.y - d.p.y);
      d.p = p;
      d.moved = true;
      this.requestRender();
      return;
    }
    if (d.kind === 'draw') {
      const m = d.mark;
      if (m.points) {
        const last = m.points[m.points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) >= Math.max(1, m.width / 4)) m.points.push([p.x, p.y]);
      } else {
        let x2 = p.x, y2 = p.y;
        if (e.shiftKey) {
          const dx = x2 - m.x1, dy = y2 - m.y1;
          if (m.tool === 'line' || m.tool === 'arrow') { // snap to 45 degrees
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
            x2 = m.x1 + Math.cos(ang) * len; y2 = m.y1 + Math.sin(ang) * len;
          } else { // square / circle
            const sz = Math.max(Math.abs(dx), Math.abs(dy));
            x2 = m.x1 + Math.sign(dx || 1) * sz; y2 = m.y1 + Math.sign(dy || 1) * sz;
          }
        }
        m.x2 = clamp(x2, -this.W, 2 * this.W);
        m.y2 = clamp(y2, -this.H, 2 * this.H);
      }
      this.requestRender();
    }
  }

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') { if (this.pointers.size < 2) this.drag = null; return; }
    this.drag = null;
    if (d.kind === 'crop' || d.kind === 'pan') { this.render(); return; }
    if (d.kind === 'move') { if (d.moved) this.commit(); return; }
    if (d.kind === 'draw' && !cancelled) {
      // minimum size on screen (not in image pixels), so small marks also work when zoomed in
      const m = d.mark, min = 4 * (this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width));
      const ok = m.points ? m.points.length > 1 || m.tool === 'pen'
        : m.tool === 'line' || m.tool === 'arrow' ? Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > min
          : Math.abs(m.x2 - m.x1) > min && Math.abs(m.y2 - m.y1) > min;
      if (ok) { this.state.marks.push(m); this.commit(); return; }
    }
    this.render();
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: this.zoom };
  }

  removeSelected() {
    if (this.selected < 0 || !this.state.marks[this.selected]) return;
    this.state.marks.splice(this.selected, 1);
    this.selected = -1;
    this.renderOptions();
    this.commit();
  }

  // ---------- side panel: adjust and settings ----------
  togglePanel(name) {
    this.panel = this.panel === name ? null : name;
    this.renderPanel();
    this.updateButtons();
    window.setTimeout(() => this.onResize(), 0);
  }

  renderPanel() {
    const p = this.panelEl;
    p.replaceChildren();
    p.classList.toggle('is-open', !!this.panel);
    if (!this.panel) return;
    const head = el('div', 'pmp-panel-head');
    head.append(el('b', '', this.panel === 'adjust' ? t('adjust') : t('settings')));
    iconButton(head, 'x', t('close'), t('close'), 'pmp-icon-only').addEventListener('click', () => this.togglePanel(this.panel));
    p.append(head);
    const body = el('div', 'pmp-panel-body');
    p.append(body);
    if (this.panel === 'settings') {
      renderSettings(body, this.plugin, (key) => this.settingChanged(key));
      return;
    }
    const a = this.state.adj;
    const slider = (key, min, max) => {
      const row = el('label', 'pmp-slider');
      const val = el('span', 'pmp-val', String(a[key]));
      const head2 = el('span', 'pmp-slider-head');
      head2.append(el('span', '', t(key)), val);
      const r = el('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.value = String(a[key]);
      r.dataset.adjust = key;
      r.addEventListener('input', () => { a[key] = +r.value; val.textContent = r.value; this.previewAdjust(); this.updateInfo(); });
      r.addEventListener('change', () => { this.refreshImage(); this.commit(); });
      r.addEventListener('dblclick', () => { r.value = '0'; a[key] = 0; val.textContent = '0'; this.refreshImage(); this.commit(); });
      row.append(head2, r);
      body.append(row);
    };
    if (!this.ready) return;
    slider('brightness', -100, 100);
    slider('contrast', -100, 100);
    slider('saturation', -100, 100);
    slider('warmth', -100, 100);
    slider('sharpness', 0, 100);
    const toggles = el('div', 'pmp-toggles');
    for (const key of ['grayscale', 'sepia', 'invert']) {
      const b = el('button', 'pmp-btn pmp-chip', t(key));
      b.type = 'button';
      b.dataset.adjust = key;
      b.classList.toggle('is-active', !!a[key]);
      b.addEventListener('click', () => { a[key] = !a[key]; this.refreshImage(); this.commit(); this.renderPanel(); });
      toggles.append(b);
    }
    body.append(toggles);
    const reset = el('button', 'pmp-btn', t('resetAdjust'));
    reset.type = 'button';
    reset.disabled = isNeutral(a);
    reset.addEventListener('click', () => { this.state.adj = Object.assign({}, NO_ADJUST); this.refreshImage(); this.commit(); this.renderPanel(); });
    body.append(reset);
    // size when saving
    body.append(el('div', 'pmp-panel-sub', t('sizeSection')));
    const r0 = this.cropRect();
    const row = el('label', 'pmp-slider');
    const val = el('span', 'pmp-val');
    const showSize = () => { val.textContent = `${this.state.size}% · ${t('sizeInfo', Math.round((r0.w * this.state.size) / 100), Math.round((r0.h * this.state.size) / 100))}`; };
    const head3 = el('span', 'pmp-slider-head');
    head3.append(el('span', '', t('size')), val);
    const rs = el('input');
    rs.type = 'range';
    rs.min = '5';
    rs.max = '100';
    rs.value = String(this.state.size);
    rs.dataset.size = '1';
    rs.addEventListener('input', () => { this.state.size = +rs.value; showSize(); this.updateInfo(); });
    rs.addEventListener('change', () => this.commit());
    showSize();
    row.append(head3, rs);
    body.append(row);
    const quick = el('div', 'pmp-toggles');
    for (const pct of [100, 75, 50, 25]) {
      const b = el('button', 'pmp-btn pmp-chip', `${pct}%`);
      b.type = 'button';
      b.classList.toggle('is-active', this.state.size === pct);
      b.addEventListener('click', () => { this.state.size = pct; this.commit(); this.renderPanel(); });
      quick.append(b);
    }
    body.append(quick);
  }

  settingChanged(key) {
    if (key === 'showLabels') this.contentEl.classList.toggle('pmp-labels', !!this.s.showLabels);
    if (key === 'filmstrip') this.renderFilm();
    if (key === 'language') { this.buildUi(); if (this.ready) { this.fit(); this.box.classList.remove('pmp-hidden'); this.status.textContent = ''; } return; }
    if (key === 'gallery') {
      this.gallery = this.plugin.galleryFor(this.file, this.sourcePath);
      this.index = Math.max(0, this.gallery.indexOf(this.file));
      this.renderFilm();
    }
    if (['color', 'highlightColor', 'blockColor', 'lineWidth', 'fontSize', 'textBackground'].includes(key)) this.renderOptions();
    this.updateButtons();
  }

  // ---------- gallery ----------
  renderFilm() {
    const f = this.film;
    if (!f) return;
    f.replaceChildren();
    const show = this.s.filmstrip && this.gallery.length > 1;
    f.classList.toggle('pmp-hidden', !show);
    if (!show) return;
    this.gallery.forEach((file, i) => {
      const b = el('button', 'pmp-thumb');
      b.type = 'button';
      b.title = file.name;
      b.setAttribute('aria-label', file.name);
      b.classList.toggle('is-active', i === this.index);
      const img = el('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = this.app.vault.getResourcePath(file);
      b.append(img);
      b.addEventListener('click', () => this.go(i));
      f.append(b);
    });
    const active = f.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  async go(i) {
    if (this.busy || i < 0 || i >= this.gallery.length || i === this.index) return;
    const target = this.gallery[i]; // saving a copy below can shift the list
    if (this.cropping) this.applyCrop();
    this.endTyping(true);
    if (this.dirty) {
      let choice = this.s.onSwitch;
      if (choice === 'ask') {
        const r = await ask(this.app, {
          title: t('switchTitle'), text: t('switchText', this.file.name),
          choices: [{ id: 'cancel', label: t('cancel') }, { id: 'discard', label: t('dontSave') }, { id: 'save', label: t('saveAndGo'), cta: true, focus: true }],
        });
        choice = r.id;
      }
      if (choice === 'save') { if (!(await this.save('none'))) return; }
      else if (choice !== 'discard') return;
    }
    if (target) await this.load(target);
  }

  // ---------- saving ----------
  output() {
    const f = this.s.format;
    const mime = f === 'png' ? 'image/png' : f === 'jpeg' ? 'image/jpeg' : f === 'webp' ? 'image/webp' : mimeOf(this.file.extension);
    return { mime, sameType: mime === mimeOf(this.file.extension) };
  }

  // after: close | stay | next | none (used when switching images)
  async save(after) {
    if (!this.ready || this.busy) return false;
    this.endTyping(true);
    if (this.cropping) this.applyCrop();
    if (!this.dirty) return false;
    this.busy = true;
    this.btnSave.querySelector('.pmp-label').textContent = t('saving');
    this.updateButtons();
    try {
      const { mime, sameType } = this.output();
      const out = this.exportCanvas(mime);
      const blob = await new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob returned nothing'))), mime, this.s.quality / 100));
      const data = await blob.arrayBuffer();
      const fallback = !!blob.type && blob.type !== mime; // e.g. WebP is not supported on this platform
      let target = this.file;
      if (this.s.saveMode === 'overwrite' && sameType && !fallback) {
        await this.app.vault.modifyBinary(this.file, data);
        new Notice(t('saved', this.file.name));
      } else {
        const copy = await this.plugin.saveCopy(this.file, data, extOf(blob.type || mime));
        const updated = await this.plugin.updateLinks(this.file, copy, this.sourcePath);
        new Notice((fallback ? `${t('webpFallback')} ` : '') + t('savedCopy', copy.name, updated));
        target = copy;
        if (updated && this.s.gallery !== 'folder') this.gallery[this.index] = copy;
        else this.gallery.splice(this.index + 1, 0, copy);
        if (this.gallery[this.index] !== copy) this.index += 1;
      }
      this.cache.delete(this.file.path);
      this.cache.delete(target.path);
      this.plugin.refreshImages(target);
      this.file = target;
      this.nameEl.textContent = target.name;
      this.busy = false;
      this.btnSave.querySelector('.pmp-label').textContent = t('save');
      if (after === 'close') { this.closing = true; super.close(); return true; }
      // keep going with the saved result as the new original
      this.startWith(out);
      this.renderFilm();
      this.updateButtons();
      if (after === 'next') {
        if (this.index < this.gallery.length - 1) await this.go(this.index + 1);
        else { this.closing = true; super.close(); }
      }
      return true;
    } catch (e) {
      this.busy = false;
      this.btnSave.querySelector('.pmp-label').textContent = t('save');
      this.status.textContent = t('saveFailed', e.message);
      this.status.classList.add('pmp-error');
      this.updateButtons();
      return false;
    }
  }

  // ---------- deleting ----------
  async deleteImage() {
    if (this.busy) return;
    const file = this.file;
    const note = this.plugin.noteOf(this.sourcePath);
    const embedded = note ? this.plugin.embedsOf(note, file).length > 0 : false;
    let removeEmbeds = embedded && this.s.removeEmbedsOnDelete;
    if (this.s.confirmDelete) {
      const r = await ask(this.app, {
        title: t('deleteTitle'), text: t('deleteText', file.name),
        check: embedded ? { label: t('deleteEmbeds', note.basename), value: this.s.removeEmbedsOnDelete } : null,
        choices: [{ id: 'cancel', label: t('cancel'), focus: true }, { id: 'delete', label: t('deleteConfirm'), warning: true }],
      });
      if (r.id !== 'delete') return;
      removeEmbeds = embedded && r.checked;
    }
    this.busy = true;
    this.updateButtons();
    try {
      const removed = removeEmbeds ? await this.plugin.removeEmbeds(note, file) : 0;
      await this.plugin.trash(file);
      new Notice(removed ? t('deletedEmbeds', file.name, removed) : t('deleted', file.name));
      this.cache.delete(file.path);
      const i = this.gallery.indexOf(file);
      if (i >= 0) this.gallery.splice(i, 1);
      this.busy = false;
      if (!this.gallery.length) { this.closing = true; super.close(); return; }
      this.index = Math.min(Math.max(0, i), this.gallery.length - 1);
      await this.load(this.gallery[this.index]);
    } catch (e) {
      this.busy = false;
      this.updateButtons();
      new Notice(t('deleteFailed', e.message));
    }
  }

  // ---------- closing ----------
  // Esc, the close button and clicking outside all end up here
  close() {
    if (this.closing) { super.close(); return; }
    if (this.typing) { this.endTyping(false); return; }
    if (this.cropping) { this.cancelCrop(); return; }
    if (this.busy) return;
    if (this.dirty && this.s.confirmClose) {
      if (this.confirming) return;
      this.confirming = true;
      ask(this.app, {
        title: t('discardTitle'), text: t('discardText'),
        choices: [{ id: 'keep', label: t('keepEditing'), cta: true, focus: true }, { id: 'discard', label: t('discard'), warning: true }],
      }).then((r) => {
        this.confirming = false;
        if (r.id === 'discard') { this.closing = true; super.close(); }
      });
      return;
    }
    this.closing = true;
    super.close();
  }

  onClose() {
    this.loadToken++;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    if (this.src && this.src.close) this.src.close();
    this.cache.clear();
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

// ---------------------------------------------------------------- settings tab
class PhotoMarkSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() { renderSettings(this.containerEl, this.plugin); }
}

// ---------------------------------------------------------------- plugin
module.exports = class PhotoMarkPlus extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!saved.settingsVersion || saved.settingsVersion < 2) {
      // 2.0: the Edit button sits in the top left corner of an image
      this.settings.buttonPosition = 'top-left';
      this.settings.settingsVersion = SETTINGS_VERSION;
      if (Object.keys(saved).length) await this.saveSettings();
    }
    if (!TOOL_IDS.includes(this.settings.tool) || this.settings.tool === 'crop') this.settings.tool = 'rect';
    languageSetting = this.settings.language || 'auto';
    this.imageCache = new WeakMap(); // img -> { src, file }
    this.addSettingTab(new PhotoMarkSettingTab(this.app, this));
    this.setupHoverButton();

    // right-click on an image in the file explorer (and the "more options" menu of an open image)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!isEditable(file)) return;
      menu.addItem((item) => item.setTitle(t('menuEdit')).setIcon('pencil').onClick(() => this.open(file)));
    }));
    // right-click in the editor on a line with an image
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      const source = (view && view.file && view.file.path) || '';
      for (const f of this.imagesInLine(editor.getLine(editor.getCursor().line), source)) {
        menu.addItem((item) => item.setTitle(t('menuEditNamed', f.name)).setIcon('pencil').onClick(() => this.open(f, source)));
      }
    }));
    this.addCommand({ id: 'mark-image', name: t('command'), callback: () => this.editFromCommand() });
  }

  async saveSettings() { await this.saveData(this.settings); }

  // after the language setting changed: texts that are created once
  applyLanguage() {
    languageSetting = this.settings.language || 'auto';
    this.applyButtonStyle();
  }

  applyButtonStyle() {
    const b = this.hoverButton;
    if (!b) return;
    b.title = t('editTitle');
    b.setAttribute('aria-label', t('editTitle'));
    b.querySelector('.pmp-label').textContent = t('edit');
    b.classList.toggle('pmp-hover-icon', this.settings.buttonStyle === 'icon');
  }

  open(file, sourcePath) {
    new EditorModal(this, file, sourcePath).open();
  }

  // ---------- which images to browse ----------
  galleryFor(file, sourcePath) {
    const mode = this.settings.gallery;
    let list = [];
    if (mode !== 'folder' && sourcePath) list = this.imagesInNote(sourcePath);
    if (!list.includes(file) && mode !== 'note') list = this.imagesInFolder(file);
    return list.includes(file) ? list : [file];
  }

  noteOf(path) {
    const note = path && this.app.vault.getAbstractFileByPath(path);
    return note instanceof TFile && note.extension === 'md' ? note : null;
  }

  imagesInNote(path) {
    const note = this.noteOf(path);
    if (!note) return [];
    const cache = this.app.metadataCache.getFileCache(note);
    const out = [];
    for (const e of (cache && cache.embeds) || []) {
      const f = this.resolve((e.link || '').split('#')[0], note.path);
      if (isEditable(f) && !out.includes(f)) out.push(f);
    }
    return out;
  }

  imagesInFolder(file) {
    const kids = (file.parent && file.parent.children) || [];
    return kids.filter(isEditable).sort(naturalSort);
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

  // "copy" mode and other file types: new file next to the original, never overwriting anything
  async saveCopy(file, data, ext) {
    const folder = file.parent && file.parent.path && file.parent.path !== '/' ? `${file.parent.path}/` : '';
    const suffix = this.settings.saveMode === 'copy' || ext !== file.extension ? this.settings.copySuffix : '';
    const base = `${folder}${file.basename}${suffix}`;
    let path = `${base}.${ext}`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${base}-${n}.${ext}`;
    return this.app.vault.createBinary(path, data);
  }

  // embeds of `file` in `note`, with their position, from Obsidian's metadata cache
  embedsOf(note, file) {
    const cache = this.app.metadataCache.getFileCache(note);
    return ((cache && cache.embeds) || []).filter((e) => {
      const link = (e.link || '').split('#')[0];
      return link && e.position && this.resolve(link, note.path) === file;
    });
  }

  // point the embeds in the note we started from at the copy; returns how many links changed
  async updateLinks(oldFile, newFile, sourcePath) {
    const note = this.noteOf(sourcePath);
    if (!note) return 0;
    const edits = [];
    for (const e of this.embedsOf(note, oldFile)) {
      const link = (e.link || '').split('#')[0];
      const target = link.includes('/') ? `${link.slice(0, link.lastIndexOf('/') + 1)}${newFile.name}` : newFile.name;
      const o = e.original || '';
      let text = null;
      for (const form of [link, encodeURI(link), link.replace(/ /g, '%20')]) {
        if (o.includes(form)) { text = o.replace(form, form === link ? target : encodeURI(target)); break; }
      }
      if (text) edits.push({ from: e.position.start.offset, to: e.position.end.offset, original: o, text });
    }
    return this.applyEdits(note, edits);
  }

  // remove the embeds of `file` from `note` (a line that only held the embed goes completely)
  async removeEmbeds(note, file) {
    const edits = this.embedsOf(note, file).map((e) => ({ from: e.position.start.offset, to: e.position.end.offset, original: e.original || '', text: '', line: true }));
    return this.applyEdits(note, edits);
  }

  async applyEdits(note, edits) {
    if (!edits.length) return 0;
    edits.sort((a, b) => b.from - a.from);
    let done = 0;
    await this.app.vault.process(note, (content) => {
      let out = content;
      for (const ed of edits) {
        if (ed.original && out.slice(ed.from, ed.to) !== ed.original) continue; // the note changed meanwhile
        let from = ed.from, to = ed.to;
        if (ed.line) {
          const start = out.lastIndexOf('\n', from - 1) + 1;
          const endNl = out.indexOf('\n', to);
          const end = endNl < 0 ? out.length : endNl;
          if (!out.slice(start, from).trim() && !out.slice(to, end).trim()) { from = start; to = endNl < 0 ? end : end + 1; }
        }
        out = out.slice(0, from) + ed.text + out.slice(to);
        done++;
      }
      return out;
    });
    return done;
  }

  // to the trash as set in Obsidian (Files and links > Deleted files)
  async trash(file) {
    const fm = this.app.fileManager;
    if (fm && typeof fm.trashFile === 'function') return fm.trashFile(file);
    return this.app.vault.trash(file, true);
  }

  // ---------- the floating "Edit" button ----------
  setupHoverButton() {
    const button = el('button', 'pmp-hover');
    button.type = 'button';
    const icon = el('span', 'pmp-icon');
    setIcon(icon, 'pencil');
    button.append(icon, el('span', 'pmp-label', t('edit')));
    document.body.append(button);
    this.hoverButton = button;
    this.applyButtonStyle();
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
      const pos = this.settings.buttonPosition || 'top-left';
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
      if (e.target !== button && !button.contains(e.target)) onImage(e);
      else if (current && !current.tapped) window.clearTimeout(timer);
    });
    // after scrolling the pointer can rest on an image without a new mouseover: show again on movement
    this.registerDomEvent(document, 'mousemove', (e) => { if (!current && !e.buttons) onImage(e); }, { passive: true });
    this.registerDomEvent(document, 'mouseout', (e) => {
      if (!current || current.tapped || (e.target !== current.img && e.target !== button && !button.contains(e.target))) return;
      if (e.relatedTarget && (e.relatedTarget === button || button.contains(e.relatedTarget) || e.relatedTarget === current.img)) return;
      hideLater(250);
    });
    // touch screens: tap an image = show the button for a few seconds
    this.registerDomEvent(document, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target === button || button.contains(e.target) || !this.settings.hoverButton) return;
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

  // path of the note an image is shown in (for the gallery and for updating links)
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
    // ![](path/image.png) and others: the resource URL points into the vault folder
    return this.fileFromUrl(src);
  }

  // the vault path behind a resource URL, without listing the files of the vault
  fileFromUrl(src) {
    const key = plainUrl(src);
    if (!key || /^(data|blob):/i.test(key)) return null; // external http(s) images simply never match the vault folder
    const base = this.resourceBase();
    if (!base || !key.startsWith(base)) return null;
    const f = this.app.vault.getAbstractFileByPath(key.slice(base.length).replace(/^\/+/, ''));
    return isEditable(f) ? f : null;
  }

  resourceBase() {
    if (this.base !== undefined) return this.base;
    this.base = null;
    try {
      const probe = 'photomark-probe.png';
      const url = plainUrl(this.app.vault.adapter.getResourcePath(probe));
      if (url.endsWith(probe)) this.base = url.slice(0, -probe.length);
    } catch (e) { /* adapter without resource paths */ }
    return this.base;
  }

  resolve(link, sourcePath) {
    let path = String(link || '').trim();
    try { path = decodeURIComponent(path); } catch (e) { /* keep as is */ }
    if (!path) return null;
    const f = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath || '');
    if (f) return f;
    // relative path (![](./img/x.png)) from the folder of the note
    const folder = (sourcePath || '').includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
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
  editFromCommand() {
    const ws = this.app.workspace;
    const leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null;
    const view = leaf && leaf.view;
    if (view && view.getViewType && view.getViewType() === 'image' && isEditable(view.file)) return this.open(view.file);
    const file = ws.getActiveFile();
    if (!file) return new Notice(t('noFile'));
    if (isEditable(file)) return this.open(file);
    const editor = ws.activeEditor && ws.activeEditor.editor;
    if (editor) {
      const here = this.imagesInLine(editor.getLine(editor.getCursor().line), file.path);
      if (here.length === 1) return this.open(here[0], file.path);
    }
    const images = this.imagesInNote(file.path);
    if (!images.length) return new Notice(t('noImages'));
    if (images.length === 1) return this.open(images[0], file.path);
    new PickImageModal(this.app, images, (f) => this.open(f, file.path)).open();
    return undefined;
  }
};
