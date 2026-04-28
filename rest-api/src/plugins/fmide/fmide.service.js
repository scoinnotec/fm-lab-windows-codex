const db = require('../../config/database');
const { getLoadedPlugins } = require('../loader');

/**
 * fmIDE Thingamajig URI Service
 *
 * Generates navigation URIs for FileMaker objects based on the ObjectCatalog.
 * The URIcorn transforms these into fmp:// URLs that open fmIDE in FileMaker.
 */

// Parameter mapping: ObjectCatalog Type -> fmIDE parameter name
const DIRECT_TYPE_MAP = {
  Script:              '$script_name',
  Layout:              '$layout_name',
  LayoutObject:        '$object_name',
  LayoutPart:          '$layout_part_name',
  BaseTable:           '$base_table_name',
  TableOccurrence:     '$t_o_name',
  CustomFunction:      '$custom_function_name',
  ValueList:           '$value_list_name',
  Account:             '$account_name',
  PrivilegeSet:        '$privilege_set_name',
  Theme:               '$theme_name',
  CustomMenu:          '$custom_menu_name',
  ExtendedPrivilege:   '$extended_privilege_name',
  ExternalDataSource:  '$external_data_source_name',
};

// Types that need additional context joins
const CONTEXT_TYPES = new Set(['ScriptStep', 'Field']);

// Types with indirect mapping (fallback to related object)
const INDIRECT_TYPES = new Set(['Relationship', 'ScriptTrigger']);

// All supported types
const SUPPORTED_TYPES = new Set([
  ...Object.keys(DIRECT_TYPE_MAP),
  ...CONTEXT_TYPES,
  ...INDIRECT_TYPES,
]);

/**
 * Simple percent-encoding for fmp:// URL parameter values.
 * Covers the characters commonly found in FileMaker object names.
 */
function encodeParam(value) {
  if (!value) return '';
  return value
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/&/g, '%26')
    .replace(/=/g, '%3D')
    .replace(/\+/g, '%2B')
    .replace(/\//g, '%2F')
    .replace(/\?/g, '%3F')
    .replace(/#/g, '%23');
}

/**
 * Get the current fmIDE config from the loaded plugin manifest.
 */
function getConfig() {
  const plugins = getLoadedPlugins();
  const manifest = plugins.fmide;
  return manifest?.config || {
    fmp_protocol: 'fmp',
    server_address: '$',
    script_name: 'fmIDE',
  };
}

/**
 * Update config values in memory (not persistent).
 */
function updateConfig(newValues) {
  const plugins = getLoadedPlugins();
  const manifest = plugins.fmide;
  if (!manifest) return null;
  Object.assign(manifest.config, newValues);
  return manifest.config;
}

/**
 * Build the Thingamajig URI for a given object.
 * Returns { thingamajig_uri, fmp_url, supported } or null.
 */
async function buildUri(uuid, configOverrides) {
  const config = { ...getConfig(), ...configOverrides };

  // Fetch the object from ObjectCatalog
  const objResult = await db.executeQuery(
    'SELECT Object_UUID, Object_Type, Object_Name, File_Name FROM ObjectCatalog WHERE Object_UUID = ?',
    [uuid]
  );

  if (objResult.rows.length === 0) {
    return null;
  }

  const obj = objResult.rows[0];
  const objectType = obj.Object_Type;

  if (!SUPPORTED_TYPES.has(objectType)) {
    return {
      object_uuid: obj.Object_UUID,
      object_type: objectType,
      object_name: obj.Object_Name,
      file_name: obj.File_Name,
      thingamajig_uri: null,
      fmp_url: null,
      supported: false,
    };
  }

  let thingamajigUri = null;

  // --- Direct mapping (simple parameter) ---
  if (DIRECT_TYPE_MAP[objectType]) {
    const param = DIRECT_TYPE_MAP[objectType];
    thingamajigUri = `${obj.File_Name}&${param}=${encodeParam(obj.Object_Name)}`;
  }

  // --- Context types (need JOINs) ---
  else if (objectType === 'ScriptStep') {
    // Navigate to parent script + step number
    const stepResult = await db.executeQuery(`
      SELECT
        oc_script.Object_Name AS Script_Name,
        oc_script.File_Name AS Script_File,
        s.Step_Index
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
      JOIN StepsForScripts s ON s.Step_UUID = ?
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'parent_script'
      LIMIT 1
    `, [uuid, uuid]);

    if (stepResult.rows.length > 0) {
      const row = stepResult.rows[0];
      const fileName = row.Script_File || obj.File_Name;
      thingamajigUri = `${fileName}&$script_name=${encodeParam(row.Script_Name)}`
        + `&$script_step_number=${row.Step_Index}`;
    }
  }

  else if (objectType === 'Field') {
    // Field needs base_table_name as context
    const tableResult = await db.executeQuery(`
      SELECT oc_table.Object_Name AS Table_Name
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_table ON ol.Target_UUID = oc_table.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'parent_table'
      LIMIT 1
    `, [uuid]);

    if (tableResult.rows.length > 0) {
      thingamajigUri = `${obj.File_Name}&$base_table_name=${encodeParam(tableResult.rows[0].Table_Name)}`
        + `&$field_name=${encodeParam(obj.Object_Name)}`;
    } else {
      // Fallback: field without resolved table
      thingamajigUri = `${obj.File_Name}&$field_name=${encodeParam(obj.Object_Name)}`;
    }
  }

  // --- Indirect mapping (fallback to related object) ---
  else if (objectType === 'Relationship') {
    // Navigate to left TableOccurrence
    const toResult = await db.executeQuery(`
      SELECT oc_to.Object_Name AS TO_Name, oc_to.File_Name AS TO_File
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_to ON ol.Target_UUID = oc_to.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'left_table'
      LIMIT 1
    `, [uuid]);

    if (toResult.rows.length > 0) {
      const row = toResult.rows[0];
      thingamajigUri = `${row.TO_File || obj.File_Name}&$t_o_name=${encodeParam(row.TO_Name)}`;
    }
  }

  else if (objectType === 'ScriptTrigger') {
    // Navigate to the triggered script
    const triggerResult = await db.executeQuery(`
      SELECT oc_script.Object_Name AS Script_Name, oc_script.File_Name AS Script_File
      FROM ObjectLinks ol
      JOIN ObjectCatalog oc_script ON ol.Target_UUID = oc_script.Object_UUID
      WHERE ol.Source_UUID = ?
        AND ol.Link_Role = 'trigger_script'
      LIMIT 1
    `, [uuid]);

    if (triggerResult.rows.length > 0) {
      const row = triggerResult.rows[0];
      thingamajigUri = `${row.Script_File || obj.File_Name}&$script_name=${encodeParam(row.Script_Name)}`;
    }
  }

  // Build full fmp:// URL
  let fmpUrl = null;
  if (thingamajigUri) {
    fmpUrl = `${config.fmp_protocol}://${config.server_address}/${thingamajigUri.replace('&', `?script=${config.script_name}&`)}`;
  }

  return {
    object_uuid: obj.Object_UUID,
    object_type: objectType,
    object_name: obj.Object_Name,
    file_name: obj.File_Name,
    thingamajig_uri: thingamajigUri,
    fmp_url: fmpUrl,
    supported: thingamajigUri !== null,
  };
}

/**
 * Batch: generate URIs for multiple UUIDs.
 */
async function buildUris(uuids, configOverrides) {
  const results = [];
  for (const uuid of uuids) {
    const result = await buildUri(uuid, configOverrides);
    if (result) results.push(result);
  }
  return results;
}

module.exports = {
  buildUri,
  buildUris,
  getConfig,
  updateConfig,
  SUPPORTED_TYPES,
  encodeParam,
};
