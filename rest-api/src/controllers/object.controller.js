const objectService = require('../services/object.service');
const formatters = require('../formatters');
const { sendFormatted } = require('../utils/response-builder');

/**
 * Object Controller
 * Handles requests for object-related endpoints
 */

/**
 * GET /api/get - Get object by UUID
 */
async function get(req, res, next) {
  try {
    const { uuid, format = 'json', meta, debug } = req.query;

    const result = await objectService.getByUUID(uuid);

    const formattedData = formatters.format([result.data], format);

    sendFormatted(
      res,
      format === 'json' ? formattedData[0] : formattedData,
      format,
      meta ? result.meta : null,
      debug ? `SELECT * FROM ObjectCatalog WHERE Object_UUID = '${uuid}'` : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/list - List objects by type
 */
async function list(req, res, next) {
  try {
    const { type, file, limit, format = 'json', meta, debug } = req.query;

    const result = await objectService.listObjects({ type, file, limit });

    const formattedData = formatters.format(result.data, format);

    const debugQuery = debug
      ? `SELECT oc.*, COUNT(ol.Target_UUID) as Reference_Count FROM ObjectCatalog oc LEFT JOIN ObjectLinks ol ON oc.Object_UUID = ol.Source_UUID WHERE oc.Object_Type = '${type}'${file ? ` AND oc.File_Name = '${file}'` : ''} GROUP BY oc.Object_UUID ORDER BY oc.Object_Name LIMIT ${limit}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/count - Count objects
 */
async function count(req, res, next) {
  try {
    const { type, file, group_by, format = 'json', meta, debug } = req.query;

    const result = await objectService.countObjects({ type, file, group_by });

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? 'COUNT query (SQL not shown for brevity)' : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/search - Search objects by name
 */
async function search(req, res, next) {
  try {
    const { name, type, file, limit, offset, format = 'json', meta, debug } = req.query;

    const result = await objectService.searchObjects({ name, type, file, limit, offset });

    const formattedData = formatters.format(result.data, format);

    const debugQuery = debug
      ? `SELECT * FROM ObjectCatalog WHERE Object_Name LIKE '${name}'${type ? ` AND Object_Type = '${type}'` : ''}${file ? ` AND File_Name = '${file}'` : ''} ORDER BY Object_Name LIMIT ${limit} OFFSET ${offset}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/search/count - Count search results by name pattern
 */
async function searchCount(req, res, next) {
  try {
    const { name, type, file, format = 'json', meta, debug } = req.query;

    const result = await objectService.countSearchResults({ name, type, file });

    const formattedData = formatters.format(result.data, format);

    const debugQuery = debug
      ? `SELECT COUNT(*) as count FROM ObjectCatalog WHERE Object_Name ILIKE '${name}'${type ? ` AND Object_Type = '${type}'` : ''}${file ? ` AND File_Name = '${file}'` : ''}`
      : null;

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debugQuery
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/references - Get object references
 */
async function references(req, res, next) {
  try {
    const { uuid, direction, link_type, limit, format = 'json', meta, debug } = req.query;

    const result = await objectService.getReferences({ uuid, direction, link_type, limit });

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? `References query for ${direction} direction (SQL not shown for brevity)` : null
    );
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/get-details - Get object details by UUID (type-specific template dispatch)
 */
async function getDetails(req, res, next) {
  try {
    const { uuid, format = 'json', meta, debug } = req.query;

    const result = await objectService.getDetails(uuid);

    // Content templates auto-override to content formatter (except JSON)
    let effectiveFormat = format;
    if (result.meta.template_type === 'content' && format !== 'json') {
      effectiveFormat = 'content';
    }

    const formattedData = formatters.format(result.data, effectiveFormat);

    sendFormatted(
      res,
      formattedData,
      effectiveFormat,
      meta ? result.meta : null,
      debug ? result.sql : null
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  get,
  getDetails,
  list,
  count,
  search,
  searchCount,
  references,
};
