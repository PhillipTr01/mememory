// after creation 
document.addEventListener('DOMContentLoaded', function () {
    // setting correct username
    setUsername();
}, false);

function logoutUser() {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                window.location.href = "/";
            }
        }
    }
    request.open('GET', '/requests/authentication/logout');
    request.send();
    return;
}

function setUsername() {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                var username = JSON.parse(this.responseText).username;
                var gameDiv = document.getElementById('gameIDdiv'); 
                document.getElementById('gameID').innerText = 'GameID: ' + sessionStorage.getItem('gameID');
                gameDiv.addEventListener('click', () => {
                    copyStringToClipboard(sessionStorage.getItem('gameID'));
                });
                // Singleplayer shows the own name in the first row (multiplayer draws its own list)
                var user1 = document.getElementById('user1Username');
                if (user1 != null) {
                    user1.innerText = username;
                }
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}

function copyStringToClipboard (str) {
    var el = document.createElement('textarea');
    el.value = str;
    el.setAttribute('readonly', '');
    el.style = {position: 'absolute', left: '-9999px'};
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    document.getElementById("gameIDdescr").style.display="none";
 }

function closeCardModal() {
    modal.style.display = "none";
}