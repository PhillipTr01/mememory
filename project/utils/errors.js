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

module.exports = { httpError, asyncHandler };
