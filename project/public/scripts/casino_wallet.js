/*
 * Secret casino pages: the own coins in the bar at the top. A click opens the
 * payout: the coins come off the balance, the admin pays them out.
 * Uses the `socket` of the page (it sends "coins").
 */
(function () {
  var button = document.getElementById("navCoins");
  var coins = 0;

  function format(value) {
    return Number(value).toLocaleString("en-US");
  }

  socket.on("coins", (data) => {
    var before = coins;
    coins = data.coins;
    button.hidden = false;
    document.getElementById("navCoinsValue").innerText = format(coins);
    if (before && coins != before) {
      button.classList.remove("up", "down");
      void button.offsetWidth; // restart the animation
      button.classList.add(coins > before ? "up" : "down");
    }
  });

  function el(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.innerText = text;
    return element;
  }

  var STATUS = { open: "⏳ waiting", paid: "✅ paid", rejected: "↩️ rejected - coins back" };

  async function payoutDialog() {
    var backdrop = el("div", "mm-dialog-backdrop");
    var dialog = el("div", "mm-dialog nav-payout");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    var title = el("h2", "mm-dialog-title", "💸 Pay out coins");
    var text = el("p", "mm-dialog-text", "At least 5,000 coins, in steps of 1,000. The coins come off your balance right away and are paid out by the admin.");
    var balance = el("div", "nav-payout-balance", "Your coins: 🪙 " + format(coins));
    var input = el("input", "mm-input");
    input.type = "number";
    input.min = 5000;
    input.max = Math.floor(coins / 1000) * 1000;
    input.step = 1000;
    input.value = coins >= 5000 ? 5000 : "";
    input.placeholder = "5,000, 6,000, ...";
    input.setAttribute("aria-label", "Coins to pay out");
    var error = el("p", "jp-error");
    error.hidden = true;
    var list = el("div", "nav-payout-list");
    var buttons = el("div", "mm-dialog-actions");
    var cancel = el("button", "mm-btn", "Close");
    cancel.type = "button";
    var ok = el("button", "mm-btn mm-btn-primary", "Pay out");
    ok.type = "button";
    buttons.append(cancel, ok);
    dialog.append(title, text, balance, input, error, buttons, list);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    var close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    };
    var onKey = (event) => event.key == "Escape" && close();
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => event.target == backdrop && close());

    // The own last payouts (relative: next to the page, under the secret address)
    async function loadList() {
      try {
        var rows = await (await fetch("withdrawals")).json();
        list.replaceChildren(
          ...(rows.length ? [el("div", "nav-payout-head", "Your last payouts")] : []),
          ...rows.map((w) => {
            var row = el("div", "nav-payout-row " + w.status);
            row.append(el("span", "", "🪙 " + format(w.amount)), el("span", "", STATUS[w.status] + (w.note ? " · " + w.note : "")), el("span", "mm-muted", new Date(w.createdAt).toLocaleDateString()));
            return row;
          }),
        );
      } catch (e) {
        // the list is only a bonus
      }
    }

    ok.addEventListener("click", async () => {
      var amount = Number(input.value);
      error.hidden = true;
      ok.disabled = true;
      try {
        var res = await fetch("withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amount }) });
        var data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "That didn't work.");
        showToast("💸 " + format(amount) + " coins are on their way");
        input.value = "";
        loadList();
      } catch (e) {
        error.innerText = e.message;
        error.hidden = false;
      } finally {
        ok.disabled = false;
      }
    });
    input.focus();
    loadList();
  }

  button.addEventListener("click", payoutDialog);
})();
