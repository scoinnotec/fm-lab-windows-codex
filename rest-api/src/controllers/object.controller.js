const objectService = require('../services/object.service');
const templateService = require('../services/template.service');
const formatters = require('../formatters');
const { sendFormatted } = require('../utils/response-builder');
const { createError } = require('../middleware/error-handler');

/**
 * Object Controller
 * Handles requests for object-related endpoints
 */

// Mapping API-Type → interne Source_Table für FolderHierarchy/list_with_folders.sql
const SUBTYPE_FOR_TYPE = {
  script:         'ScriptCatalog',
  layout:         'Layouts',
  customfunction: 'CustomFunctionsCatalog',
};

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
 * GET /api/list-with-folders - Hierarchisch annotierte Liste eines Subtyps (Scripts/Layouts/CFs).
 * Liefert Items + Folder + Separators in sequenzieller Reihenfolge mit nesting_level.
 * Wrappt das Custom-Template list_with_folders.sql.
 */
async function listWithFolders(req, res, next) {
  try {
    const { type, file, format = 'json', meta, debug } = req.query;
    const subtype = SUBTYPE_FOR_TYPE[type];

    const result = await templateService.executeTemplate(
      'list_with_folders',
      { subtype, file },
      'query'
    );

    const formattedData = formatters.format(result.data, format);

    sendFormatted(
      res,
      formattedData,
      format,
      meta ? result.meta : null,
      debug ? result.sql : null
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

    // format=tokens has its own dispatch path with type-specific templates and
    // dedicated post-processing. Use a per-type look-up plus the tokens formatter
    // instead of running the generic detail template through the format pipeline.
    if (format === 'tokens') {
      return await respondWithTokens(req, res, { uuid, meta, debug });
    }

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

/**
 * format=tokens dispatcher for /api/get-details.
 *
 * Looks up the object type from ObjectCatalog, then runs the token-specific
 * SQL template(s) for that type and feeds the rows through the tokens formatter.
 * Currently supported: Script, CustomFunction. Other types return 400.
 */
async function respondWithTokens(req, res, { uuid, meta, debug }) {
  // 1. Look up object metadata so we know which token template to run.
  const lookup = await objectService.getByUUID(uuid);
  const objectType = lookup.data.Object_Type;
  const baseObject = {
    uuid,
    name: lookup.data.Object_Name,
    file: lookup.data.File_Name,
  };

  let payload;
  let metaInfo = {
    object_type: objectType,
    object_name: lookup.data.Object_Name,
    file_name: lookup.data.File_Name,
  };
  let debugSql = null;

  if (objectType === 'Script') {
    const stepsResult = await templateService.executeTemplate(
      'object_details_script_tokens',
      { uuid },
      'report'
    );
    const refsResult = await templateService.executeTemplate(
      'object_references_script',
      { uuid },
      'report'
    );

    payload = formatters.format(stepsResult.data, 'tokens', {
      kind: 'script',
      object: baseObject,
      refs: refsResult.data,
    });

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_script_tokens',
      references_template: 'object_references_script',
    };
    debugSql = debug ? `${stepsResult.sql}\n\n-- references:\n${refsResult.sql}` : null;
  } else if (objectType === 'CustomFunction') {
    const cfResult = await templateService.executeTemplate(
      'object_details_customfunction_tokens',
      { uuid },
      'report'
    );

    payload = formatters.format(cfResult.data, 'tokens', {
      kind: 'customfunction',
      object: baseObject,
    });

    metaInfo = {
      ...metaInfo,
      template_used: 'object_details_customfunction_tokens',
    };
    debugSql = debug ? cfResult.sql : null;
  } else {
    throw createError(
      'VALIDATION_ERROR',
      `format=tokens is not supported for object type '${objectType}'`,
      { uuid, objectType, supported: ['Script', 'CustomFunction'] }
    );
  }

  return sendFormatted(res, payload, 'tokens', meta ? metaInfo : null, debugSql);
}

/**
 * GET /api/get-calc - Standalone calculation by hash (token format only)
 */
async function getCalc(req, res, next) {
  try {
    const { hash, format = 'tokens', meta, debug } = req.query;

    const result = await templateService.executeTemplate(
      'object_details_calculation_tokens',
      { hash },
      'report'
    );

    if (!result.data || result.data.length === 0) {
      throw createError(
        'OBJECT_NOT_FOUND',
        `Calculation with hash '${hash}' not found`,
        { hash }
      );
    }

    const payload = formatters.format(result.data, 'tokens', {
      kind: 'calculation',
      object: { hash },
    });

    const metaInfo = meta ? {
      template_used: 'object_details_calculation_tokens',
      hash,
    } : null;

    return sendFormatted(res, payload, format, metaInfo, debug ? result.sql : null);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  get,
  getDetails,
  getCalc,
  list,
  listWithFolders,
  count,
  search,
  searchCount,
  references,
};
