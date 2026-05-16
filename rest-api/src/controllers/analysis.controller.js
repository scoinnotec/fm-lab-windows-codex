const toUsageService = require('../services/to-usage.service');
const objectUsageService = require('../services/object-usage.service');
const credentialService = require('../services/credential.service');
const apiIntegrationService = require('../services/api-integration.service');
const layoutObjectQualityService = require('../services/layout-object-quality.service');
const qualityService = require('../services/quality.service');
const formatters = require('../formatters');
const { sendFormatted } = require('../utils/response-builder');

async function tableOccurrenceUsage(req, res, next) {
  try {
    const {
      q,
      file,
      unused_only,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await toUsageService.listTableOccurrenceUsage({
      q,
      file,
      unusedOnly: unused_only,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `table-occurrence-usage q=${q || ''} file=${file || ''} unused_only=${!!unused_only} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function tableOccurrenceUsageCount(req, res, next) {
  try {
    const { q, file, unused_only, format = 'json', meta, debug } = req.query;

    const result = await toUsageService.countTableOccurrenceUsage({
      q,
      file,
      unusedOnly: unused_only,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `table-occurrence-usage-count q=${q || ''} file=${file || ''} unused_only=${!!unused_only}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function objectUsage(req, res, next) {
  try {
    const {
      type,
      q,
      file,
      unused_only,
      max_usage,
      sort,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await objectUsageService.listObjectUsage({
      type,
      q,
      file,
      unusedOnly: unused_only,
      maxUsage: max_usage,
      sort,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `object-usage type=${type || ''} q=${q || ''} file=${file || ''} unused_only=${!!unused_only} max_usage=${max_usage || ''} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function objectUsageCount(req, res, next) {
  try {
    const { type, q, file, unused_only, max_usage, format = 'json', meta, debug } = req.query;

    const result = await objectUsageService.countObjectUsage({
      type,
      q,
      file,
      unusedOnly: unused_only,
      maxUsage: max_usage,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `object-usage-count type=${type || ''} q=${q || ''} file=${file || ''} unused_only=${!!unused_only} max_usage=${max_usage || ''}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function credentialFindings(req, res, next) {
  try {
    const {
      q,
      file,
      category,
      risk,
      secret_only,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await credentialService.listCredentialFindings({
      q,
      file,
      category,
      risk,
      secretOnly: secret_only,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `credential-findings q=${q || ''} file=${file || ''} category=${category || ''} risk=${risk || ''} secret_only=${!!secret_only} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function credentialFindingsCount(req, res, next) {
  try {
    const { q, file, category, risk, secret_only, format = 'json', meta, debug } = req.query;

    const result = await credentialService.countCredentialFindings({
      q,
      file,
      category,
      risk,
      secretOnly: secret_only,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `credential-findings-count q=${q || ''} file=${file || ''} category=${category || ''} risk=${risk || ''} secret_only=${!!secret_only}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function apiIntegrations(req, res, next) {
  try {
    const {
      q,
      file,
      family,
      type,
      risk,
      secret_only,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await apiIntegrationService.listApiIntegrations({
      q,
      file,
      family,
      type,
      risk,
      secretOnly: secret_only,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `api-integrations q=${q || ''} file=${file || ''} family=${family || ''} type=${type || ''} risk=${risk || ''} secret_only=${!!secret_only} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function apiIntegrationsCount(req, res, next) {
  try {
    const { q, file, family, type, risk, secret_only, format = 'json', meta, debug } = req.query;

    const result = await apiIntegrationService.countApiIntegrations({
      q,
      file,
      family,
      type,
      risk,
      secretOnly: secret_only,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `api-integrations-count q=${q || ''} file=${file || ''} family=${family || ''} type=${type || ''} risk=${risk || ''} secret_only=${!!secret_only}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function apiIntegrationSummary(req, res, next) {
  try {
    const {
      q,
      file,
      family,
      type,
      risk,
      secret_only,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await apiIntegrationService.listApiIntegrationSummary({
      q,
      file,
      family,
      type,
      risk,
      secretOnly: secret_only,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `api-integrations-summary q=${q || ''} file=${file || ''} family=${family || ''} type=${type || ''} risk=${risk || ''} secret_only=${!!secret_only} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function layoutObjectQuality(req, res, next) {
  try {
    const {
      q,
      file,
      category,
      severity,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await layoutObjectQualityService.listLayoutObjectQualityFindings({
      q,
      file,
      category,
      severity,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `layout-object-quality q=${q || ''} file=${file || ''} category=${category || ''} severity=${severity || ''} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function layoutObjectQualityCount(req, res, next) {
  try {
    const { q, file, category, severity, format = 'json', meta, debug } = req.query;

    const result = await layoutObjectQualityService.countLayoutObjectQualityFindings({
      q,
      file,
      category,
      severity,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `layout-object-quality-count q=${q || ''} file=${file || ''} category=${category || ''} severity=${severity || ''}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function qualityFindings(req, res, next) {
  try {
    const {
      q,
      file,
      area,
      category,
      severity,
      type,
      limit,
      offset,
      format = 'json',
      meta,
      debug,
    } = req.query;

    const result = await qualityService.listQualityFindings({
      q,
      file,
      area,
      category,
      severity,
      type,
      limit,
      offset,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `quality-findings q=${q || ''} file=${file || ''} area=${area || ''} category=${category || ''} severity=${severity || ''} type=${type || ''} limit=${limit} offset=${offset}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function qualityFindingsCount(req, res, next) {
  try {
    const { q, file, area, category, severity, type, format = 'json', meta, debug } = req.query;

    const result = await qualityService.countQualityFindings({
      q,
      file,
      area,
      category,
      severity,
      type,
    });

    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug
      ? `quality-findings-count q=${q || ''} file=${file || ''} area=${area || ''} category=${category || ''} severity=${severity || ''} type=${type || ''}`
      : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

async function qualityDashboard(req, res, next) {
  try {
    const { file, format = 'json', meta, debug } = req.query;

    const result = await qualityService.getQualityDashboard({ file });
    const formattedData = formatters.format(result.data, format);
    const debugInfo = debug ? `quality-dashboard file=${file || ''}` : null;

    sendFormatted(res, formattedData, format, meta ? result.meta : null, debugInfo);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  tableOccurrenceUsage,
  tableOccurrenceUsageCount,
  objectUsage,
  objectUsageCount,
  credentialFindings,
  credentialFindingsCount,
  apiIntegrations,
  apiIntegrationsCount,
  apiIntegrationSummary,
  layoutObjectQuality,
  layoutObjectQualityCount,
  qualityFindings,
  qualityFindingsCount,
  qualityDashboard,
};
