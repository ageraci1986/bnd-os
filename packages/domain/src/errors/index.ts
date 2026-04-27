export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DomainError';
    this.code = code;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends DomainError {
  readonly issues: readonly { path: string; message: string }[];
  constructor(issues: readonly { path: string; message: string }[]) {
    super('VALIDATION', 'Validation failed');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class LastAdminProtectedError extends DomainError {
  constructor() {
    super(
      'LAST_ADMIN_PROTECTED',
      'Cannot remove or downgrade the last remaining admin of the workspace.',
    );
    this.name = 'LastAdminProtectedError';
  }
}
