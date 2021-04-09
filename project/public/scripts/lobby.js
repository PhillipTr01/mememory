//after creation 
document.addEventListener('DOMContentLoaded', function () {
    //setting correct username
    setUsername();
}, false);

//Keep dropdown open if clicked on other groups
document.getElementById("keep-open-dropdown").addEventListener("click", function (e) {
    e.stopPropagation();
}, false);

function startScoreboardPage() {
    window.location.href = "/home";
    return;
}

function startProfilePage() {
    window.location.href = "/user";
    return;
}

function startSettingsPage() {
    window.location.href = "/settings";
    return;
}

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
                document.getElementById('username').innerText = JSON.parse(this.responseText).username;
            }
        }
    }
    request.open('GET', '/requests/user/username');
    request.send();
}