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
                var gameDiv = document.getElementById('gameID'); 
                gameDiv.innerText = 'GameID: ' + sessionStorage.getItem('gameID');
                gameDiv.addEventListener('click', () => {
                    copyStringToClipboard(sessionStorage.getItem('gameID'));
                });
                document.getElementById('user1Username').innerText = username;
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
 }

function closeCardModal() {
    modal.style.display = "none";
}