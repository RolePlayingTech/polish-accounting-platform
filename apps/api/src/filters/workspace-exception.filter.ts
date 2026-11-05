import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { AccountingWorkspaceError } from '@pap/application';
import {
  DoubleEntryValidationError,
  InvalidIdentifierError,
  InvalidMoneyAmountError,
  LegalRuleNotFoundError,
  UnverifiedLegalRuleError,
} from '@pap/domain';
import { InvalidQuizSubmissionError } from '@pap/domain/academy';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

function httpErrorLabel(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable_entity';
    default:
      return 'internal_server_error';
  }
}

@Catch()
export class AccountingWorkspaceExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        reply.status(status).send(body);
        return;
      }
      reply.status(status).send({
        statusCode: status,
        error: httpErrorLabel(status),
        reasonCode: httpErrorLabel(status),
        message: typeof body === 'string' ? body : exception.message,
      });
      return;
    }

    if (exception instanceof AccountingWorkspaceError) {
      reply.status(exception.statusCode).send({
        statusCode: exception.statusCode,
        error: httpErrorLabel(exception.statusCode),
        reasonCode: exception.reasonCode,
        message: exception.message,
      });
      return;
    }

    if (exception instanceof ZodError) {
      const issues = exception.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
        message: issue.message,
      }));
      reply.status(400).send({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'validation_error',
        message: issues[0]?.message ?? 'Dane wejściowe nie przeszły walidacji kontraktu.',
        issues,
      });
      return;
    }

    if (exception instanceof InvalidIdentifierError) {
      reply.status(400).send({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_identifier',
        message: 'Niepoprawny format identyfikatora UUID zasobu.',
      });
      return;
    }

    if (exception instanceof InvalidMoneyAmountError) {
      reply.status(400).send({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_money_amount',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof InvalidQuizSubmissionError) {
      const status = exception.message.toLowerCase().includes('nie znaleziono') ? 404 : 400;
      reply.status(status).send({
        statusCode: status,
        error: httpErrorLabel(status),
        reasonCode: status === 404 ? 'lesson_not_found' : 'invalid_quiz_submission',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof LegalRuleNotFoundError) {
      reply.status(404).send({
        statusCode: 404,
        error: 'not_found',
        reasonCode: 'legal_rule_not_found',
        message: exception.message,
      });
      return;
    }

    if (
      exception instanceof UnverifiedLegalRuleError ||
      exception instanceof DoubleEntryValidationError
    ) {
      reply.status(422).send({
        statusCode: 422,
        error: 'unprocessable_entity',
        reasonCode: 'domain_rule_violation',
        message: exception.message,
      });
      return;
    }

    reply.status(500).send({
      statusCode: 500,
      error: 'internal_server_error',
      reasonCode: 'internal_server_error',
      message: 'Wystąpił nieoczekiwany błąd wewnętrzny serwera.',
    });
  }
}
