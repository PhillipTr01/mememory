/*
 * Small helpers so that every route handler reports errors the same way and
 * no rejected promise can slip past Express (Express 4 does not catch errors
 * thrown inside async handlers by itself).
 */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Wraps an async route handler and forwards any thrown error to next().
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      if (!error.status) {
        // Mongoose validation / cast errors are client errors, anything else is ours.
        error.status =
          error.name === "ValidationError" || error.name === "CastError"
            ? 400
            : 500;
      }
      next(error);
    });
  };
}

// No route for the address: a 404 (the error handler shows it)
function notFound(req, res, next) {
  next(httpError(404, "Not found."));
}

/*
 * Last handler: errors as JSON - a page that doesn't exist gets the 404 page.
 * Internals of server errors are only logged.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return;
  res.status(status);
  if (status === 404 && req.method === "GET" && req.accepts(["json", "html"]) === "html") {
    return require("./pages").page("404.html")(req, res, next);
  }
  const message = status >= 500 ? "Internal server error." : status === 404 ? "Not found." : err.message;
  res.send({ error: { status: status, message: message } });
}

module.exports = { httpError, asyncHandler, notFound, errorHandler };
