process.env.NODE_ENV = 'test';
process.env.ALLOW_DEBUG_OUTPUT = '0';
process.env.DEBUG_QUERY_NORMALIZER = '0';

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  initialize: jest.fn(async () => ({})),
  close: jest.fn(async () => undefined),
  isReferenceAttached: jest.fn(() => false),
  getDatabaseStats: jest.fn(async () => ({
    connected: true,
    database_path: 'test.duckdb',
    size_mb: 1.25,
    table_count: 12,
  })),
  executeQuery: jest.fn(async (sql) => {
    if (sql.includes('FROM FilesCatalog')) {
      return {
        rows: [{
          File_Name: 'Sample_Solution',
          File_FullName: 'Sample_Solution.fmp12',
          FileMaker_Version: '21',
          Has_DDR_INFO: true,
          Import_Timestamp: '2026-05-16T10:00:00.000Z',
        }],
        meta: { result_count: 1, execution_time_ms: 1 },
      };
    }
    if (sql.includes('FROM ObjectCatalog')) {
      return {
        rows: [
          { Object_Type: 'Script', count: 2n },
          { Object_Type: 'Layout', count: 1n },
        ],
        meta: { result_count: 2, execution_time_ms: 1 },
      };
    }
    if (sql.includes('FROM ObjectLinks')) {
      return {
        rows: [{
          total_links: 3n,
          cross_file_links: 1n,
          operational_links: 2n,
          structural_links: 1n,
        }],
        meta: { result_count: 1, execution_time_ms: 1 },
      };
    }
    return { rows: [], meta: { result_count: 0, execution_time_ms: 1 } };
  }),
}));

jest.mock('../src/services/object.service', () => ({
  searchObjects: jest.fn(async ({ name, type, file, limit, offset }) => ({
    data: [{
      Object_UUID: 'script-1',
      Object_Name: name,
      Object_Type: type || 'Script',
      File_Name: file || 'Sample_Solution',
    }],
    meta: { result_count: 1, limit, offset },
  })),
  countSearchResults: jest.fn(async () => ({
    data: [{ count: 1 }],
    meta: { result_count: 1 },
  })),
  searchScriptContents: jest.fn(async ({ q, file, limit, offset }) => ({
    data: [{
      Script_UUID: 'script-1',
      Script_Name: 'Sample Script',
      Step_Number: 1,
      Snippet: q,
      File_Name: file || 'Sample_Solution',
    }],
    meta: { result_count: 1, limit, offset },
  })),
  countScriptContentResults: jest.fn(async () => ({
    data: [{ count: 1 }],
    meta: { result_count: 1 },
  })),
}));

jest.mock('../src/services/to-usage.service', () => ({
  listTableOccurrenceUsage: jest.fn(async ({ limit, offset }) => ({
    data: [{
      TO_UUID: 'to-1',
      TO_Name: 'Customers',
      File_Name: 'Sample_Solution',
      usage_count: 5,
    }],
    meta: { result_count: 1, limit, offset },
  })),
  countTableOccurrenceUsage: jest.fn(async () => ({
    data: [{ count: 1 }],
    meta: { result_count: 1 },
  })),
}));

const objectService = require('../src/services/object.service');
const toUsageService = require('../src/services/to-usage.service');
const app = require('../src/index');

describe('API smoke tests', () => {
  afterEach(() => {
    process.env.DEBUG_QUERY_NORMALIZER = '0';
    delete process.env.LOG_LEVEL;
    jest.clearAllMocks();
  });

  it('serves the root endpoint', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('FileMaker DuckDB Analysis API');
    expect(res.body.endpoints.version).toBe('/api/version');
  });

  it('serves /api/version with database health metadata', async () => {
    const res = await request(app).get('/api/version');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.health).toBe('healthy');
    expect(res.body.data.database.connected).toBe(true);
  });

  it('serves /api/info with solution statistics', async () => {
    const res = await request(app).get('/api/info');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.solution.file_count).toBe(1);
    expect(res.body.data.solution.object_statistics.total_objects).toBe(3);
  });

  it('normalizes query keys before object search validation', async () => {
    const res = await request(app).get('/api/search?Name=Button&Limit=2');

    expect(res.status).toBe(200);
    expect(objectService.searchObjects).toHaveBeenCalledWith({
      name: 'Button',
      type: undefined,
      file: undefined,
      limit: 2,
      offset: 0,
    });
    expect(res.body.data[0].Object_Name).toBe('Button');
  });

  it('searches script contents through the API route', async () => {
    const res = await request(app).get('/api/search/scripts?q=Perform&limit=1');

    expect(res.status).toBe(200);
    expect(objectService.searchScriptContents).toHaveBeenCalledWith({
      q: 'Perform',
      file: undefined,
      folderUuids: undefined,
      limit: 1,
      offset: 0,
    });
    expect(res.body.data[0].Snippet).toBe('Perform');
  });

  it('serves an analysis endpoint', async () => {
    const res = await request(app).get('/api/analysis/table-occurrences/usage?limit=1');

    expect(res.status).toBe(200);
    expect(toUsageService.listTableOccurrenceUsage).toHaveBeenCalledWith({
      q: undefined,
      file: undefined,
      unusedOnly: false,
      limit: 1,
      offset: 0,
    });
    expect(res.body.data[0].TO_Name).toBe('Customers');
  });

  it('returns a standardized validation error', async () => {
    const res = await request(app).get('/api/search');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not log query normalization details unless explicitly enabled', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await request(app).get('/api/search?Name=Button');
    expect(logSpy).not.toHaveBeenCalled();

    process.env.DEBUG_QUERY_NORMALIZER = '1';
    process.env.LOG_LEVEL = 'debug';
    await request(app).get('/api/search?Name=Button');
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
