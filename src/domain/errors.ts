export class TemplateNotFoundError extends Error {
  constructor(eventType: string) {
    super(`No template configured for event: ${eventType}`);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateValidationError extends Error {
  constructor(eventType: string, details: string) {
    super(`Payload validation failed for event ${eventType}: ${details}`);
    this.name = 'TemplateValidationError';
  }
}

export class MailerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MailerError';
    this.cause = cause;
  }
}
