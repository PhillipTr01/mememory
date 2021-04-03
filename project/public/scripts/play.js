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
                document.getElementById('gameID').innerText = 'GameID: ' + sessionStorage.getItem('gameID');
                document.getElementById('user1Username').innerText = username;
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}

function closeCardModal() {
    modal.style.display = "none";
}