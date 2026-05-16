const appLogger = require('../src/utils/app-logger');

describe('appLogger', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('writes text logs with structured metadata', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.LOG_FORMAT = 'text';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    appLogger.info('Server started', { port: 3003 });

    expect(infoSpy).toHaveBeenCalledWith('[INFO] Server started {"port":3003}');
  });

  it('respects the configured log level', () => {
    process.env.LOG_LEVEL = 'warn';
    process.env.LOG_FORMAT = 'text';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    appLogger.info('Hidden info');
    appLogger.warn('Visible warning');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[WARN] Visible warning');
  });

  it('writes JSON logs and serializes bigint metadata safely', () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.LOG_FORMAT = 'json';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    appLogger.debug('Query result', { rows: 2n });

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload.level).toBe('debug');
    expect(payload.message).toBe('Query result');
    expect(payload.rows).toBe(2);
    expect(payload.timestamp).toEqual(expect.any(String));
  });

  it('normalizes Error objects in metadata', () => {
    process.env.LOG_LEVEL = 'error';
    process.env.LOG_FORMAT = 'json';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    appLogger.error('Failure', { error: new Error('Boom') });

    const payload = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(payload.error.message).toBe('Boom');
    expect(payload.error.stack).toContain('Boom');
  });
});
