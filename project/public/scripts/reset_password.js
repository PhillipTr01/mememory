/*
 * A password reset link from the admin (/reset-password?token=...): the link is checked, then the player
 * picks a new password. The token leaves the address bar right away (it is a key - not for the history).
 */
(function () {
  // (kept for this tab: a reload still works)
  var token = new URLSearchParams(window.location.search).get("token") || "";
  try {
    if (token) sessionStorage.setItem("resetToken", token);
    else token = sessionStorage.getItem("resetToken") || "";
  } catch (error) {}
  if (token) history.replaceState(null, "", window.location.pathname);
  var show = (id) => ["rpLoading", "rpForm", "rpDone", "rpGone"].forEach((other) => (document.getElementById(other).hidden = other != id));

  function post(path, body) {
    return fetch("/requests/authentication/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((res) =>
      res.json().then(
        (data) => ({ ok: res.ok, status: res.status, data: data }),
        () => ({ ok: res.ok, status: res.status, data: {} }),
      ),
    );
  }

  if (!token) return show("rpGone");
  post("reset-password/check", { token: token })
    .then((answer) => {
      if (!answer.ok) return show("rpGone");
      document.getElementById("rpUser").innerText = answer.data.username;
      show("rpForm");
      document.getElementById("rpPassword1").focus();
    })
    .catch(() => show("rpGone"));

  var form = document.getElementById("rpForm");
  var weak = document.getElementById("rpWeak");
  var same = document.getElementById("rpSame");
  var save = document.getElementById("rpSave");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    var password = document.getElementById("rpPassword1").value;
    var repeat = document.getElementById("rpPassword2").value;
    weak.classList.add("visually-hidden");
    same.classList.add("visually-hidden");
    if (password !== repeat) return same.classList.remove("visually-hidden");
    save.disabled = true;
    post("reset-password", { token: token, password: password, repeatPassword: repeat })
      .then((answer) => {
        save.disabled = false;
        if (answer.ok) {
          try {
            sessionStorage.removeItem("resetToken");
          } catch (error) {}
          return show("rpDone");
        }
        var message = (answer.data.error && answer.data.error.message) || "";
        if (answer.status == 410) return show("rpGone");
        if (message.includes("not matching")) return same.classList.remove("visually-hidden");
        weak.classList.remove("visually-hidden");
      })
      .catch(() => (save.disabled = false));
  });
})();
