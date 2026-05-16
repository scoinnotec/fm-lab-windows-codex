describe('response-builder debug gating', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  function loadBuilder({ nodeEnv, allowDebugOutput }) {
    jest.resetModules();
    process.env.NODE_ENV = nodeEnv;
    process.env.ALLOW_DEBUG_OUTPUT = allowDebugOutput;
    process.env.DUCKDB_PATH = './package.json';
    return require('../src/utils/response-builder');
  }

  it('omits debug SQL by default', () => {
    const { buildSuccess } = loadBuilder({ nodeEnv: 'development', allowDebugOutput: '0' });

    const response = buildSuccess([], null, 'SELECT * FROM SecretTable');

    expect(response.debug).toBeUndefined();
  });

  it('includes debug SQL only when explicitly enabled outside production', () => {
    const { buildSuccess } = loadBuilder({ nodeEnv: 'development', allowDebugOutput: '1' });

    const response = buildSuccess([], null, 'SELECT 1');

    expect(response.debug).toEqual({ query: 'SELECT 1' });
  });

  it('omits debug SQL in production even when the switch is set', () => {
    const { buildSuccess } = loadBuilder({ nodeEnv: 'production', allowDebugOutput: '1' });

    const response = buildSuccess([], null, 'SELECT * FROM SecretTable');

    expect(response.debug).toBeUndefined();
  });
});
