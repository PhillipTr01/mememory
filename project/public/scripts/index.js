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
  var usernameLabel = document.getElementById('registerUsernameLabel');
  var passwordLabel = document.getElementById('registerPassword1Label');
  var repeatPasswordLabel = document.getElementById('registerPassword2Label');

  //resetRegisterLabels
  emailLabel.innerText = "Email";
  emailLabel.classList.remove("text-danger");
  usernameLabel.innerText = "Username";
  usernameLabel.classList.remove("text-danger");
  passwordLabel.innerText = "Password";
  passwordLabel.classList.remove("text-danger");
  repeatPasswordLabel.innerText = "Repeat Password";
  repeatPasswordLabel.classList.remove("text-danger");

/*  //checkEmail
  //RFC 5322 Official Standard
  var emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if (!emailRegex.test(email)) {
    emailLabel.innerText = "This is not an email";
    emailLabel.classList.add("text-danger");
    return;
  }

  //checkUsername
  if (username.length > 16 || username.length < 3) {
    usernameLabel.innerText = "Username must be between 3 and 16 characters";
    usernameLabel.classList.add("text-danger");
    return;
  }

  //checkPasswordLength
  if (password.length < 8) {
    passwordLabel.innerText = "Password must be at least 8 characters long";
    passwordLabel.classList.add("text-danger");
    return;
  }

  //checkPasswordStrength
  var passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
  if (!passwordRegex.test(password)) {
    passwordLabel.innerText = "Password is to weak (must contain at least one letter, one number and one special character)";
    passwordLabel.classList.add("text-danger");
    return;
  }

  //comparePasswords
  if (password != repeatPassword) {
    repeatPasswordLabel.innerText = "Password is not identical";
    repeatPasswordLabel.classList.add("text-danger");
    return;
  }
  */

  var registerRequest = new XMLHttpRequest();

  registerRequest.onreadystatechange = function (e) {
    if (this.readyState == 4) {
      var response = JSON.parse(this.responseText).error.message;

      if (this.status == 201) {

        loginUser(username, password);

      } else if (this.status == 400) {
        
        if (response.includes("email: Path `email` is invalid")) {
          emailLabel.innerText = "This is not an email";
          emailLabel.classList.add("text-danger");
          return;
        }

        if (response.includes("username: Path `username`")) {
          usernameLabel.innerText = "Username must be between 3 and 16 characters";
          usernameLabel.classList.add("text-danger");
          return;
        }

        switch (response) {
          case "password: Path `password` is shorter than the minimum allowed length (8).":
            passwordLabel.innerText = "Password must be at least 8 characters long";
            passwordLabel.classList.add("text-danger");
            return;
          case "password: Path `password` is too weak.":
            passwordLabel.innerText = "Password is to weak (must contain at least one letter, one number and one special character)";
            passwordLabel.classList.add("text-danger");
            return;
          case "password: Path `password` is not matching with `repeatPassword`.":
            repeatPasswordLabel.innerText = "Password is not identical";
            repeatPasswordLabel.classList.add("text-danger");
            return;
        }

      } else if (this.status == 409) {

        if (response.includes("E-Mail")) {
          emailLabel.innerText = "Email is already taken";
          emailLabel.classList.add("text-danger");
        }

        if (response.includes("Username")) {
          usernameLabel.innerText = "Username is already taken";
          usernameLabel.classList.add("text-danger");
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
  var signinHeader = document.getElementById('signinHeader');
  var usernameLabel = document.getElementById('loginUsernameLabel');
  var passwordLabel = document.getElementById('loginPasswordLabel');

  //resetRegisterLabels
  signinHeader.innerText = "Sign In";
  usernameLabel.innerText = "Username";
  usernameLabel.classList.remove("text-danger");
  passwordLabel.innerText = "Password";
  passwordLabel.classList.remove("text-danger");

  var loginRequest = new XMLHttpRequest();

  loginRequest.onreadystatechange = function () {
    if (this.readyState == 4) {
      var response = JSON.parse(this.responseText).error.message;

      if (this.status == 200) {

        window.location.href = "/home";

      } else if (this.status == 401) {

        if (response.includes("Authentication: Path `authentication` failed.")) {
          signinHeader.innerText = "Sign In failed. Try again";
          usernameLabel.innerText = "Username may be invalid";
          usernameLabel.classList.add("text-danger");
          passwordLabel.innerText = "Password may be invalid";
          passwordLabel.classList.add("text-danger");
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