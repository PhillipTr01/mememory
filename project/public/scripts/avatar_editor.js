/*
 * The avatar maker: the MemeMory profile and the casino shop. The page sets
 * myName (the logged in player) and has the editor's markup (#avatarEditor).
 * /user#avatar (and shop#avatar) open it right away.
 */

var COLOR_PARTS = AVATAR_COLORS;
var editing = null; // config while the editor is open (null = letter avatar)
var editTab = 'hair';

function openAvatarEditor() {
    if (!myName) return;
    var current = avatarCache[myName];
    // Own avatar, the letter, or (nothing saved yet) the default avatar of the name
    editing = current == AVATAR_LETTER ? null : Object.assign({}, current || nameAvatar(myName));
    document.getElementById('avatarEditor').hidden = false;
    renderAvatarEditor();
    document.getElementById('avatarEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// The avatar as it is saved (null: the letter) - and: does the editor show something else?
function savedAvatar() {
    var current = avatarCache[myName];
    return current == AVATAR_LETTER ? null : current || nameAvatar(myName);
}

function avatarChanged() {
    return faceChanged() || (typeof lookChanges == 'function' && lookChanges());
}

// Only the face (the avatar maker's parts)
function faceChanged() {
    var clean = (config) => JSON.stringify(config == null ? null : cleanAvatar(config));
    return clean(editing) != clean(savedAvatar());
}

// Save only when something changed (and Reset only then too)
function updateAvatarButtons() {
    var changed = avatarChanged();
    var save = document.getElementById('avatarSave');
    if (save && !save.dataset.busy) save.disabled = !changed;
    var reset = document.getElementById('avatarReset');
    if (reset) reset.disabled = !changed;
}

function closeAvatarEditor() {
    document.getElementById('avatarEditor').hidden = true;
    editing = null;
}

// The colors are in the tab of their part (the hair color under the hair, ...)
var TAB_COLORS = { hair: 'hairColor', top: 'shirt' };
var COLOR_TITLES = { hairColor: 'Hair color', shirt: 'Color' };
// Tabs of the page on top of the parts (the casino shop: frames, animations), see shop.js:
// LOOK_TABS = {key: {label}}, renderLookOptions(key, options), decorateAvatarPreview(avatar), renderPartExtras(part, options),
// and what it picked (only shown until saved): lookChanges() -> true / false, saveLooks() -> Promise, resetLooks(), pickedColor(part)
var LOOK_TABS = window.LOOK_TABS || {};

function editorTabs() {
    var colors = Object.values(TAB_COLORS);
    return [...Object.keys(AVATAR_PARTS).filter((key) => !colors.includes(key)).map((key) => [key, AVATAR_LABELS[key]]), ...Object.entries(LOOK_TABS).map(([key, tab]) => [key, tab.label])];
}

function previewAvatar(config) {
    var fresh = createAvatarPreview(config, 'avatar-xl');
    fresh.id = 'avatarPreview';
    if (typeof decorateAvatarPreview == 'function') decorateAvatarPreview(fresh);
    return fresh;
}

// A group of options (its own grid) in the options - with a title when there is more than one
function optionGroup(options, title) {
    if (title) {
        var heading = document.createElement('span');
        heading.className = 'avatar-options-title';
        heading.innerText = title;
        options.appendChild(heading);
    }
    var grid = document.createElement('div');
    grid.className = 'avatar-option-grid';
    options.appendChild(grid);
    return grid;
}

function renderAvatarEditor() {
    // Preview
    document.getElementById('avatarPreview').replaceWith(previewAvatar(editing));
    document.getElementById('avatarLetter').disabled = editing == null;
    updateAvatarButtons();

    // Tabs: one per part (its color in it) - and the page's own
    var list = editorTabs();
    if (!list.some(([key]) => key == editTab)) editTab = list[0][0];
    var tabs = document.getElementById('avatarTabs');
    tabs.replaceChildren(...list.map(([key, label]) => {
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'avatar-tab' + (key == editTab ? ' active' : '') + (key in LOOK_TABS ? ' look' : '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', key == editTab);
        tab.innerText = label;
        tab.addEventListener('click', () => {
            editTab = key;
            renderAvatarEditor();
        });
        return tab;
    }));

    var options = document.getElementById('avatarOptions');
    options.replaceChildren();
    if (editTab in LOOK_TABS) return renderLookOptions(editTab, optionGroup(options));
    if (typeof renderPartExtras == 'function') renderPartExtras(editTab, options);
    if (COLOR_PARTS.includes(editTab)) return colorOptions(editTab, optionGroup(options, options.childElementCount ? AVATAR_LABELS[editTab] + ' color' : null));

    // Shapes as small avatars - then the color of the part
    var base = editing || AVATAR_DEFAULT;
    optionGroup(options, TAB_COLORS[editTab] ? AVATAR_LABELS[editTab] : null).append(...AVATAR_PARTS[editTab].map((value) => {
        var option = document.createElement('button');
        option.type = 'button';
        var selected = editing != null && editing[editTab] == value;
        option.className = 'avatar-option tile' + (selected ? ' selected' : '');
        option.setAttribute('aria-pressed', selected);
        var config = Object.assign({}, base);
        config[editTab] = value;
        var label = document.createElement('span');
        label.className = 'avatar-option-label';
        label.innerText = optionLabel(value);
        option.append(createAvatarPreview(config), label);
        option.title = label.innerText;
        option.addEventListener('click', () => {
            editing = Object.assign({}, base);
            editing[editTab] = value;
            renderAvatarEditor();
        });
        return option;
    }));
    if (TAB_COLORS[editTab]) colorOptions(TAB_COLORS[editTab], optionGroup(options, COLOR_TITLES[TAB_COLORS[editTab]]));
}

// The colors of a part as swatches - and any other color with the color picker
function colorOptions(part, options) {
    var base = editing || AVATAR_DEFAULT;
    options.append(...AVATAR_PARTS[part].map((value) => {
        var option = document.createElement('button');
        option.type = 'button';
        var selected = editing != null && editing[part] == value;
        option.className = 'avatar-option swatch' + (selected ? ' selected' : '');
        option.setAttribute('aria-pressed', selected);
        option.style.background = value;
        option.title = value;
        option.addEventListener('click', () => {
            editing = Object.assign({}, base);
            editing[part] = value;
            if (typeof pickedColor == 'function') pickedColor(part);
            renderAvatarEditor();
        });
        return option;
    }));
    var custom = document.createElement('label');
    var own = !AVATAR_PARTS[part].includes(base[part]);
    custom.className = 'avatar-option swatch custom' + (editing != null && own ? ' selected' : '');
    custom.title = 'Pick any color';
    if (own) custom.style.background = base[part];
    var picker = document.createElement('input');
    picker.type = 'color';
    picker.value = base[part];
    picker.setAttribute('aria-label', 'Pick any color');
    picker.addEventListener('input', () => {
        editing = Object.assign({}, editing || AVATAR_DEFAULT);
        editing[part] = picker.value;
        if (typeof pickedColor == 'function') pickedColor(part);
        // Only the preview: the picker stays open while dragging
        document.getElementById('avatarPreview').replaceWith(previewAvatar(editing));
        custom.style.background = picker.value;
        updateAvatarButtons();
    });
    picker.addEventListener('change', renderAvatarEditor);
    custom.append(createIcon('bi-eyedropper'), picker);
    options.appendChild(custom);
}

// "roundglasses" -> "Round glasses", "dealwithit" -> "Deal with it"
var OPTION_LABELS = { roundglasses: 'Round glasses', dealwithit: 'Deal with it', partyhat: 'Party hat', eyepatch: 'Eye patch', tshirt: 'T-shirt', vneck: 'V-neck', bucktooth: 'Buck tooth', chinstrap: 'Chinstrap', scumbag: 'Scumbag', none: 'None' };
function optionLabel(value) {
    return OPTION_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

// Avatar from a config (not from the cache), for the preview and the options
function createAvatarPreview(config, size) {
    var avatar = document.createElement('span');
    // No data-name: the preview must not change when the saved avatar is loaded
    avatar.className = 'mm-avatar' + (size ? ' ' + size : '');
    if (config == null) {
        avatar.style.background = avatarColor(myName);
        avatar.innerText = myName.charAt(0);
    } else {
        avatar.classList.add('has-avatar');
        avatar.appendChild(drawAvatar(config));
    }
    return avatar;
}

// Saves what changed: the face - and what the page picked to wear (the casino: frame, animation, background)
function saveAvatar() {
    var button = document.getElementById('avatarSave');
    button.disabled = true;
    var face = !faceChanged()
        ? Promise.resolve()
        : fetch('/requests/user/avatar', {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ avatar: editing == null ? AVATAR_LETTER : editing }),
          })
              .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
              // Everywhere on this page (header, profile) and in the cache for the games
              .then((data) => setAvatarConfig(myName, data.avatar));
    face
        .then(() => (typeof lookChanges == 'function' && lookChanges() ? saveLooks() : null))
        .then(() => {
            closeAvatarEditor();
            avatarMessage('Avatar saved.', 'success');
        })
        .catch(() => avatarMessage('Could not save your avatar.', 'error'))
        .finally(() => updateAvatarButtons());
}

// A message about the avatar: a toast (MemeMory) or a hint (the casino has no toasts)
function avatarMessage(text, type) {
    if (document.body.classList.contains('jackpot-theme') && typeof showHint == 'function') showHint(text, type, document.getElementById('avatarSave'));
    else showToast(text, type);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('avatarEditor')) return;
    var edit = document.getElementById('editAvatarButton');
    if (edit) edit.addEventListener('click', () => {
        if (document.getElementById('avatarEditor').hidden) openAvatarEditor();
        else closeAvatarEditor();
    });
    // #avatar: the editor open right away (the "Avatar" of the profile menu) - also when only the hash changes
    var openFromHash = () => {
        if (location.hash != '#avatar') return;
        userPromise.then((username) => {
            if (!username) return;
            myName = myName || username;
            openAvatarEditor();
        });
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    document.getElementById('avatarRandom').addEventListener('click', () => {
        editing = randomAvatar();
        renderAvatarEditor();
    });
    document.getElementById('avatarLetter').addEventListener('click', () => {
        editing = null;
        renderAvatarEditor();
    });
    // Cancel (the profile) - or Reset (the shop: back to the saved avatar, the editor stays)
    var cancel = document.getElementById('avatarCancel');
    if (cancel) cancel.addEventListener('click', closeAvatarEditor);
    var reset = document.getElementById('avatarReset');
    if (reset) reset.addEventListener('click', () => {
        var saved = savedAvatar();
        editing = saved == null ? null : Object.assign({}, saved);
        if (typeof resetLooks == 'function') resetLooks();
        renderAvatarEditor();
    });
    document.getElementById('avatarSave').addEventListener('click', saveAvatar);
});
