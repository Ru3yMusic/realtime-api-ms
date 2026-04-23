import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  afterEach(() => jest.restoreAllMocks());

  const makeHost = () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = { url: '/comments/abc' };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as any;

    return { host, response, request };
  };

  it('maps HttpException status and message to the JSON response', () => {
    const { host, response, request } = makeHost();
    const exception = new HttpException('Bad request payload', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.BAD_REQUEST,
        message: 'Bad request payload',
        path: request.url,
      }),
    );
  });

  it('uses 500 and logs the exception for unknown errors', () => {
    const { host, response } = makeHost();
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const exception = new Error('Unexpected crash');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith('Unhandled exception', exception);
  });
});
