function changePassword() {
  var oldPassword = document.getElementById("oldPassword").value;
  var newPassword = document.getElementById("newPassword").value;
  var repeatNewPassword = document.getElementById("repeatNewPassword").value;
  var oldPasswordLabel = document.getElementById("oldPasswordLabel");
  var newPasswordLabel = document.getElementById("newPasswordLabel");
  var repeatNewPasswordLabel = document.getElementById(
    "repeatNewPasswordLabel",
  );
  var buttonPW = document.getElementById("buttonNewPassword");

  //resetLabels
  oldPasswordLabel.classList.add("visually-hidden");
  newPasswordLabel.classList.add("visually-hidden");
  repeatNewPasswordLabel.classList.add("visually-hidden");
  buttonPW.innerText = "Set New Password";

  var request = new XMLHttpRequest();

  request.onreadystatechange = function () {
    if (this.readyState == 4) {
      if (this.status == 200) {
        document.getElementById("oldPassword").value = "";
        document.getElementById("newPassword").value = "";
        document.getElementById("repeatNewPassword").value = "";
        buttonPW.innerText = "Password Updated Successfully";
        showToast("Your password was changed.");
        return;
      } else if (this.status == 400 || this.status == 401) {
        var response = JSON.parse(this.responseText).error.message;

        if (
          response.includes("Authentication: Path `authentication` failed.")
        ) {
          oldPasswordLabel.classList.remove("visually-hidden");
          return;
        }

        if (response.includes("password: Path `password` is too weak.")) {
          newPasswordLabel.classList.remove("visually-hidden");
          return;
        }

        if (
          response.includes(
            "password: Path `password` is not matching with `repeatPassword`.",
          )
        ) {
          repeatNewPasswordLabel.classList.remove("visually-hidden");
          return;
        }
      }
    }
  };

  request.open("PUT", "/requests/user/changePassword", true);
  request.setRequestHeader("Content-Type", "application/json");
  request.send(
    JSON.stringify({
      oldPassword: oldPassword,
      newPassword: newPassword,
      repeatNewPassword: repeatNewPassword,
    }),
  );
}

function deleteUser() {
  var request = new XMLHttpRequest();

  request.onreadystatechange = function () {
    if (this.readyState == 4) {
      if (this.status == 200) {
        window.location.href = "/";
        return;
      }
    }
  };

  request.open("DELETE", "/requests/user");
  request.send();
}
