/**
 * An error caused by the caller's input (bad value, unknown field, wrong state).
 * The REST API answers these with 400. Anything else is a server error.
 */
class ValidationError extends Error {
    /**
     * @param {string} message Message for the caller
     */
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}

module.exports = { ValidationError };
