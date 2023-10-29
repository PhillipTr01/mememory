//after creation 
document.addEventListener('DOMContentLoaded', function () {
    //setting correct username
    setUsername();
}, false);

//Keep dropdown open if clicked on other groups
document.getElementById("keep-open-dropdown").addEventListener("click", function (e) {
    e.stopPropagation();
}, false);

function startLobbyPage() {
    window.location.href = "/lobby";
    return;
}

function startProfilePage() {
    window.location.href = "/user";
    return;
}

function startScoreboardPage() {
    window.location.href = "/home";
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

function changePassword() {
    var oldPassword = document.getElementById('oldPassword').value;
    var newPassword = document.getElementById('newPassword').value;
    var repeatNewPassword = document.getElementById('repeatNewPassword').value;
    var oldPasswordLabel = document.getElementById('oldPasswordLabel');
    var newPasswordLabel = document.getElementById('newPasswordLabel');
    var repeatNewPasswordLabel = document.getElementById('repeatNewPasswordLabel');
    var buttonPW = document.getElementById('buttonNewPassword');


    //resetLabels
    oldPasswordLabel.classList.add("visually-hidden");
    newPasswordLabel.classList.add("visually-hidden");
    repeatNewPasswordLabel.classList.add("visually-hidden");
    buttonPW.innerText = "Set New Password";

    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                document.getElementById('oldPassword').value = "";
                document.getElementById('newPassword').value = "";
                document.getElementById('repeatNewPassword').value = "";
                buttonPW.innerText = "Password Updated Successfully";
                return;

            }else if(this.status == 400 || this.status == 401){
                var response = JSON.parse(this.responseText).error.message;

                if (response.includes("Authentication: Path `authentication` failed.")) {
                    oldPasswordLabel.classList.remove("visually-hidden");
                    return;
                }

                if (response.includes("password: Path `password` is too weak.")) {
                    newPasswordLabel.classList.remove("visually-hidden");
                    return;
                }

                if (response.includes("password: Path `password` is not matching with `repeatPassword`.")) {
                    repeatNewPasswordLabel.classList.remove("visually-hidden");
                    return;
                }

            }
        }
    }

    request.open('PUT', '/requests/user/changePassword', true);
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(JSON.stringify({
        "oldPassword": oldPassword,
        "newPassword": newPassword,
        "repeatNewPassword": repeatNewPassword
    }));
}

function deleteUser() {
    var request = new XMLHttpRequest();

    request.onreadystatechange = function () {
        if (this.readyState == 4) {
            if (this.status == 200) {
                window.location.href = '/';
                return;
            }
        }
    }

    request.open('DELETE', '/requests/user');
    request.send();
}