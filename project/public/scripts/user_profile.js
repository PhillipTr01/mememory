// Profile: statistics of the logged in user, avatar maker
var myName = null;
var MODES = ["easy", "medium", "hard", "expert", "multiplayer", "tictactoe"];

document.addEventListener('DOMContentLoaded', function () {
    userPromise.then((username) => {
        if (!username) return;
        document.getElementById('heroName').innerText = username;
        var hero = createAvatar(username, 'lg');
        hero.id = 'heroAvatar';
        document.getElementById('heroAvatar').replaceWith(hero);
        myName = username;
    });
    loadStatistic();
}, false);

function loadStatistic() {
    fetch('/requests/user/statistic', { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then(showStatistic)
        .catch(() => showToast('Could not load your statistics.', 'error'));
}

function percent(win, lose, draw) {
    var games = win + lose + (draw || 0);
    return games == 0 ? 0 : Math.round((win / games) * 100);
}

function showStatistic(statistic) {
    var totalWins = 0;
    var totalGames = 0;

    MODES.forEach((mode) => {
        var win = statistic[mode + 'Win'] || 0;
        var lose = statistic[mode + 'Lose'] || 0;
        // Only Tic Tac Toe has draws
        var draw = statistic[mode + 'Draw'] || 0;
        var played = win + lose + draw;
        totalWins += win;
        totalGames += played;

        document.getElementById(mode + 'Win').innerText = win;
        document.getElementById(mode + 'Lose').innerText = lose;
        var drawElement = document.getElementById(mode + 'Draw');
        if (drawElement) drawElement.innerText = draw;
        document.getElementById(mode + 'Bar').style.width = percent(win, lose, draw) + '%';
        var footer = document.getElementById(mode + 'Rate');
        if (played == 0) {
            footer.innerText = 'No games yet';
        } else {
            var rate = document.createElement('span');
            rate.innerText = percent(win, lose, draw) + '% win rate';
            var games = document.createElement('span');
            games.innerText = played + (played == 1 ? ' game' : ' games');
            footer.replaceChildren(rate, games);
        }
    });

    document.getElementById('totalGames').innerText = totalGames;
    document.getElementById('totalWins').innerText = totalWins;
    document.getElementById('totalRate').innerText = percent(totalWins, totalGames - totalWins, 0) + '%';
}

/* ---------- Avatar maker ---------- */

var COLOR_PARTS = AVATAR_COLORS;
var editing = null; // config while the editor is open (null = letter avatar)
var editTab = 'hair';

function openAvatarEditor() {
    if (!myName) return;
    var current = avatarCache[myName];
    editing = current ? Object.assign({}, current) : randomAvatar();
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
            option.appendChild(createAvatarPreview(config));
            option.title = value;
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
        body: JSON.stringify({ avatar: editing }),
    })
        .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
        .then((data) => {
            // Everywhere on this page (header, profile) and in the cache for the games
            setAvatarConfig(myName, data.avatar);
            closeAvatarEditor();
            showToast('Avatar saved.', 'success');
        })
        .catch(() => showToast('Could not save your avatar.', 'error'))
        .finally(() => (button.disabled = false));
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('editAvatarButton').addEventListener('click', () => {
        if (document.getElementById('avatarEditor').hidden) openAvatarEditor();
        else closeAvatarEditor();
    });
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
