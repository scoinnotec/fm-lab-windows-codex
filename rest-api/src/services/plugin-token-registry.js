/**
 * Container-Plugin-Registry
 *
 * FileMaker registriert Plugin-Funktionen üblicherweise als jeweils eigenes
 * Calc-Engine-Token. Manche Plugins — wie das MBS-FileMaker-Plugin — weichen
 * davon ab: sie registrieren nur einen einzigen Token (`MBS`) und übergeben
 * den fachlichen Funktionsnamen als String im ersten Argument:
 *
 *     MBS( "List.AddPrefix"; $liste; "0|"; 1 )
 *
 * Damit der Tokens-Output (PRD prd_rest_api_plugin_docs_subfunction.md) den
 * fachlichen Funktionsnamen als `subFunction` ausspielen kann, listet diese
 * Registry alle bekannten Container-Plugins. Die `source`-Angabe korrespondiert
 * mit dem `:source`-Pfadparameter in `/api/plugin-docs/:source/:function`.
 *
 * Heute ist MBS das einzige bekannte Plugin dieser Bauart. Weitere
 * Container-Plugins können hier ohne Schema-Änderung ergänzt werden.
 */

const CONTAINER_PLUGINS = {
  MBS: { source: 'mbs' },
};

/**
 * Liefert die Container-Plugin-Konfiguration für ein Calc-Engine-Token, oder
 * `null` wenn das Token kein Container-Plugin ist.
 */
function getContainerPlugin(pluginToken) {
  if (!pluginToken) return null;
  return CONTAINER_PLUGINS[pluginToken] || null;
}

function isContainerPlugin(pluginToken) {
  return Boolean(getContainerPlugin(pluginToken));
}

module.exports = {
  CONTAINER_PLUGINS,
  getContainerPlugin,
  isContainerPlugin,
};
