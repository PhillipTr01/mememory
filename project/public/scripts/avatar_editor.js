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

function closeAvatarEditor() {
    document.getElementById('avatarEditor').hidden = true;
    editing = null;
}

function renderAvatarEditor() {
    // Preview
    var preview = document.getElementById('avatarPreview');
    var fresh = createAvatarPreview(editing, 'avatar-xl');
    fresh.id = 'avatarPreview';
    preview.replaceWith(fresh);
    document.getElementById('avatarLetter').disabled = editing == null;

    // Tabs: one per part
    var tabs = document.getElementById('avatarTabs');
    tabs.replaceChildren(...Object.keys(AVATAR_PARTS).map((key) => {
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'avatar-tab' + (key == editTab ? ' active' : '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', key == editTab);
        tab.innerText = AVATAR_LABELS[key];
        tab.addEventListener('click', () => {
            editTab = key;
            renderAvatarEditor();
        });
        return tab;
    }));

    // Options of the selected part: colors as swatches, shapes as small avatars
    var base = editing || AVATAR_DEFAULT;
    var options = document.getElementById('avatarOptions');
    options.replaceChildren(...AVATAR_PARTS[editTab].map((value) => {
        var option = document.createElement('button');
        option.type = 'button';
        var selected = editing != null && editing[editTab] == value;
        option.className = 'avatar-option' + (selected ? ' selected' : '');
        option.setAttribute('aria-pressed', selected);
        if (COLOR_PARTS.includes(editTab)) {
            option.classList.add('swatch');
            option.style.background = value;
            option.title = value;
        } else {
            var config = Object.assign({}, base);
            config[editTab] = value;
            option.classList.add('tile');
            var label = document.createElement('span');
            label.className = 'avatar-option-label';
            label.innerText = optionLabel(value);
            option.append(createAvatarPreview(config), label);
            option.title = label.innerText;
        }
        option.addEventListener('click', () => {
            editing = Object.assign({}, base);
            editing[editTab] = value;
            renderAvatarEditor();
        });
        return option;
    }));

    // Colors: any other color with the color picker
    if (COLOR_PARTS.includes(editTab)) {
        var custom = document.createElement('label');
        var own = !AVATAR_PARTS[editTab].includes(base[editTab]);
        custom.className = 'avatar-option swatch custom' + (editing != null && own ? ' selected' : '');
        custom.title = 'Pick any color';
        if (own) custom.style.background = base[editTab];
        var picker = document.createElement('input');
        picker.type = 'color';
        picker.value = base[editTab];
        picker.setAttribute('aria-label', 'Pick any color');
        picker.addEventListener('input', () => {
            editing = Object.assign({}, editing || AVATAR_DEFAULT);
            editing[editTab] = picker.value;
            // Only the preview: the picker stays open while dragging
            var fresh = createAvatarPreview(editing, 'avatar-xl');
            fresh.id = 'avatarPreview';
            document.getElementById('avatarPreview').replaceWith(fresh);
            custom.style.background = picker.value;
        });
        picker.addEventListener('change', renderAvatarEditor);
        custom.append(createIcon('bi-eyedropper'), picker);
        options.appendChild(custom);
    }
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

function saveAvatar() {
    var button = document.getElementById('avatarSave');
    button.disabled = true;
    fetch('/requests/user/avatar', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: editing == null ? AVATAR_LETTER : editing }),
    })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then((data) => {
            // Everywhere on this page (header, profile) and in the cache for the games
            setAvatarConfig(myName, data.avatar);
            closeAvatarEditor();
            avatarMessage('Avatar saved.', 'success');
        })
        .catch(() => avatarMessage('Could not save your avatar.', 'error'))
        .finally(() => (button.disabled = false));
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
    document.getElementById('avatarCancel').addEventListener('click', closeAvatarEditor);
    document.getElementById('avatarSave').addEventListener('click', saveAvatar);
});
