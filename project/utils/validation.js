/* Input validation shared by the page routes, the API and the sockets. */

const PASSWORD_REGEX =
  /^(?=.*[0-9])(?=.*[a-zA-Z])(?=.*[\*\.\!\@\$\%\^\&\#\(\)\{\}\[\]\:\;\<\>\,\.\?\/\~\_\+\-\=\|\\])\S{8,}$/;

// bcrypt only uses the first 72 bytes, longer inputs are rejected.
const MAX_PASSWORD_LENGTH = 72;

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isStrongPassword(password) {
  return (
    typeof password === "string" &&
    password.length <= MAX_PASSWORD_LENGTH &&
    PASSWORD_REGEX.test(password)
  );
}

module.exports = { isNonEmptyString, isStrongPassword };
