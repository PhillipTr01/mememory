function showRegisterFormInitial() {
  hideInitialButton();
  showRegisterForm();
}

function showRegisterForm() {
  var formShow = document.getElementById("registerForm");
  var formHide = document.getElementById("loginForm");

  formHide.classList.add("visually-hidden");

  if (formShow.classList.contains("visually-hidden")) {
    formShow.classList.remove("visually-hidden");
  }
}

function showLoginFormInitial() {
  hideInitialButton();
  showLoginForm();
}

function showLoginForm() {
  var formShow = document.getElementById("loginForm");
  var formHide = document.getElementById("registerForm");

  formHide.classList.add("visually-hidden");

  if (formShow.classList.contains("visually-hidden")) {
    formShow.classList.remove("visually-hidden");
  }
}

function hideInitialButton() {
  var loginBtn = document.getElementById("loginButton");
  loginBtn.classList.add("visually-hidden");
}

function registerUser() {
  var email = document.getElementById('registerEmail').value;
  var username = document.getElementById('registerUsername').value;
  var password = document.getElementById('registerPassword1').value;
  var repeatPassword = document.getElementById('registerPassword2').value;
  var emailLabel = document.getElementById('registerEmailLabel');
  var emailTakenLabel = document.getElementById('registerEmailTakenLabel');
  var usernameLabel = document.getElementById('registerUsernameLabel');
  var usernameTakenLabel = document.getElementById('registerUsernameTakenLabel');
  var passwordLabel = document.getElementById('registerPassword1Label');
  var repeatPasswordLabel = document.getElementById('registerPassword2Label');

  //resetRegisterLabels
  emailLabel.classList.add("visually-hidden");
  emailTakenLabel.classList.add("visually-hidden");
  usernameLabel.classList.add("visually-hidden");
  usernameTakenLabel.classList.add("visually-hidden");
  passwordLabel.classList.add("visually-hidden");
  repeatPasswordLabel.classList.add("visually-hidden");

  var registerRequest = new XMLHttpRequest();

  registerRequest.onreadystatechange = function (e) {
    if (this.readyState == 4) {

      if (this.status == 201) {

        loginUser(username, password);

      } else if (this.status == 400) {
        var response = JSON.parse(this.responseText).error.message;

        if (response.includes("email: Path `email` is invalid")) {
          emailLabel.classList.remove("visually-hidden");
          return;
        }

        if (response.includes("username: Path `username`")) {
          usernameLabel.classList.remove("visually-hidden");
          return;
        }

        if (response.includes("password: Path `password` is too weak.")) {
          passwordLabel.classList.remove("visually-hidden");
          return;
        }

        if (response.includes("password: Path `password` is not matching with `repeatPassword`.")) {
          repeatPasswordLabel.classList.remove("visually-hidden");
          return;
        }

      } else if (this.status == 409) {
        var response = JSON.parse(this.responseText).error.message;

        if (response == "email: Path `email` is already in use.") {
          emailTakenLabel.classList.remove("visually-hidden");
        }

        if (response == "username: Path `username` is already taken.") {
          usernameTakenLabel.classList.remove("visually-hidden");
        }

      }
    }
  }

  registerRequest.open('POST', '/requests/authentication/register', true);
  registerRequest.setRequestHeader('Content-Type', 'application/json');
  registerRequest.send(JSON.stringify({
    "email": email,
    "username": username,
    "password": password,
    "repeatPassword": repeatPassword
  }));
}

function loginUser(username, password) {
  var identifier = username || document.getElementById("loginUsername").value; // Identifier is either the e-mail or the username;
  var inputPassword = password || document.getElementById("loginPassword").value;
  var wrongDataLabel = document.getElementById('loginWrongDataLabel');

  //resetRegisterLabels
  wrongDataLabel.classList.add("visually-hidden");

  var loginRequest = new XMLHttpRequest();

  loginRequest.onreadystatechange = function () {
    if (this.readyState == 4) {

      if (this.status == 200) {

        window.location.href = "/home";

      } else if (this.status == 401) {
        var response = JSON.parse(this.responseText).error.message;

        if (response.includes("Authentication: Path `authentication` failed.")) {
          wrongDataLabel.classList.remove("visually-hidden");
          return;
        }

      }
    }
  }

  loginRequest.open('POST', '/requests/authentication/login', true);
  loginRequest.setRequestHeader('Content-Type', 'application/json');
  loginRequest.send(JSON.stringify({
    "username": identifier,
    "email": identifier,
    "password": inputPassword
  }));
}

var bcrypt = dcodeIO.bcrypt;