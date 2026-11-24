export class AccountingWorkspaceError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 422;
  readonly reasonCode: string;

  constructor(statusCode: 400 | 401 | 403 | 404 | 409 | 422, reasonCode: string, message: string) {
    super(message);
    this.name = 'AccountingWorkspaceError';
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
  }
}

export class AccountingWorkspaceAccessError extends AccountingWorkspaceError {
  declare readonly statusCode: 403 | 404;

  constructor(statusCode: 403 | 404, reasonCode: string, message: string) {
    super(statusCode, reasonCode, message);
    this.name = 'AccountingWorkspaceAccessError';
  }
}

export class AccountingWorkspaceValidationError extends AccountingWorkspaceError {
  declare readonly statusCode: 400 | 422;

  constructor(statusCode: 400 | 422, reasonCode: string, message: string) {
    super(statusCode, reasonCode, message);
    this.name = 'AccountingWorkspaceValidationError';
  }
}

export class AccountingWorkspaceConflictError extends AccountingWorkspaceError {
  declare readonly statusCode: 409;

  constructor(reasonCode: string, message: string) {
    super(409, reasonCode, message);
    this.name = 'AccountingWorkspaceConflictError';
  }
}
