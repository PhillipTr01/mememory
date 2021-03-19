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
    var loginBtn = document.getElementById("loginButton");
    formHide.classList.add("visually-hidden");
    if (formShow.classList.contains("visually-hidden")) {
        formShow.classList.remove("visually-hidden");
    }
    if (!loginBtn.classList.contains("visually-hidden")) {
        formShow.classList.add("visually-hidden");
    }
  }

  function hideInitialButton() {
    var loginBtn = document.getElementById("loginButton");
    loginBtn.classList.add("visually-hidden");
  }