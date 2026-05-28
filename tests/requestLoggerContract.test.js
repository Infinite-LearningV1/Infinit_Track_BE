import { jest } from '@jest/globals';

const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();
const mockDebug = jest.fn();

jest.unstable_mockModule('crypto', () => ({
  randomUUID: () => 'req-123'
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    debug: mockDebug
  }
}));

const { requestLogger, createRequestLogger } = await import('../src/middlewares/requestLogger.js');

describe('Request logger contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs request and response events as message plus metadata instead of object payloads', () => {
    const req = {
      headers: {
        'user-agent': 'jest-agent'
      },
      method: 'GET',
      path: '/api/profile',
      query: { page: '1' },
      ip: '127.0.0.1',
      connection: {
        remoteAddress: '127.0.0.1'
      }
    };

    const originalSend = jest.fn((data) => data);
    const responseErrorHandler = jest.fn();
    const res = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event, handler) => {
        if (event === 'error') {
          responseErrorHandler.mockImplementation(handler);
        }
      }),
      send: originalSend
    };
    const next = jest.fn();

    requestLogger(req, res, next);
    res.send('ok');

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
    expect(next).toHaveBeenCalled();
    expect(mockInfo).toHaveBeenNthCalledWith(
      1,
      'HTTP request started',
      expect.objectContaining({
        type: 'request',
        requestId: 'req-123',
        method: 'GET',
        path: '/api/profile',
        query: { page: '1' },
        ip: '127.0.0.1',
        userAgent: 'jest-agent',
        userId: null
      })
    );
    expect(mockInfo).toHaveBeenNthCalledWith(
      2,
      'HTTP request completed',
      expect.objectContaining({
        type: 'response',
        requestId: 'req-123',
        method: 'GET',
        path: '/api/profile',
        statusCode: 200,
        duration: expect.stringMatching(/^[0-9]+ms$/),
        userId: null
      })
    );
    expect(mockInfo).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'request' }));
    expect(mockInfo).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'response' }));
    expect(responseErrorHandler).not.toHaveBeenCalled();
  });

  it('propagates requestId through child logger helpers without wrapping the message in an object', () => {
    const req = {
      requestId: 'req-456'
    };

    const log = createRequestLogger(req);

    log.info('User action completed', {
      userId: 9,
      action: 'profile.read'
    });

    expect(mockInfo).toHaveBeenCalledWith('User action completed', {
      userId: 9,
      action: 'profile.read',
      requestId: 'req-456'
    });
    expect(mockInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'User action completed',
        userId: 9,
        action: 'profile.read',
        requestId: 'req-456'
      })
    );
  });
});
