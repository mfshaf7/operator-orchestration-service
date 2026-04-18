export class HttpError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class OpenProjectError extends Error {
  constructor(errorClass, message, statusCode, details = null) {
    super(message);
    this.name = "OpenProjectError";
    this.errorClass = errorClass;
    this.statusCode = statusCode;
    this.details = details;
  }
}
