export type UiLanguage = 'de' | 'en';

export function getUiLanguage(): UiLanguage {
  try {
    return window.localStorage.getItem('fm-lab-ui-language') === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

export function tx(language: UiLanguage, de: string, en: string) {
  return language === 'en' ? en : de;
}

export function currentText(de: string, en: string) {
  return tx(getUiLanguage(), de, en);
}

export function formatUiCount(value: number, language: UiLanguage = getUiLanguage()) {
  return value.toLocaleString(language === 'en' ? 'en-US' : 'de-DE');
}

export function optionLabel(option: { label: string; labelEn?: string }, language: UiLanguage = getUiLanguage()) {
  return language === 'en' ? option.labelEn || option.label : option.label;
}

const GENERATED_LABELS_EN: Record<string, string> = {
  'Außerhalb Layout': 'Outside layout',
  'Außerhalb Parent': 'Outside parent',
  'Leere Textobjekte': 'Empty text objects',
  'Nullmaß': 'Zero size',
  'Sehr kleine Objekte': 'Very small objects',
  'Doppelte Objektnamen': 'Duplicate object names',
  'Kopierte Objektnamen': 'Copied object names',
  'Überlappungen': 'Overlaps',
  'Referenzfehler': 'Reference errors',
  'Script-Risiken': 'Script risks',
  'Feld-Qualität': 'Field quality',
  'Erreichbarkeit': 'Reachability',
  'Namenskonventionen': 'Naming conventions',
  'Änderungen': 'Changes',
  'Zugangsdaten': 'Credentials',
  'Script-Hinweis': 'Script hint',
  'External Data Source': 'External data source',
  'FileMaker Account': 'FileMaker account',
  'SSL-Zertifikatsprüfung': 'SSL certificate verification',
  'Datenquelle': 'Data source',
  'ODBC-Datenquelle': 'ODBC data source',
  'FileMaker-Datenquelle': 'FileMaker data source',
  'Token/API-Key-Hinweis': 'Token/API key hint',
  'Passwort-Hinweis': 'Password hint',
  'Auth-Hinweis': 'Auth hint',
  'Zugangsdaten-Hinweis': 'Credential hint',
  'Benutzername': 'Username',
  'Passwort': 'Password',
  'Absendername': 'Sender name',
  'Absender-E-Mail': 'Sender email',
  'Antwortadresse': 'Reply-to address',
  'Server': 'Server',
  'Port': 'Port',
  'Authentifizierung': 'Authentication',
  'Konto': 'Account',
  'Beziehung': 'Relationship',
  'Beziehungen': 'Relationships',
  'Basistabelle': 'Base table',
  'Quelle': 'Source',
  'Objekt': 'Object',
  'Sonstige': 'Other',
};

export function localizeGeneratedLabel(value: string | null | undefined, language: UiLanguage = getUiLanguage()) {
  const raw = value || '';
  return language === 'en' ? GENERATED_LABELS_EN[raw] || raw : raw;
}

const OBJECT_TYPE_LABELS: Record<string, { de: string; en: string }> = {
  Account: { de: 'Konto', en: 'Account' },
  BaseTable: { de: 'Basistabelle', en: 'Base table' },
  BuiltinFunction: { de: 'Funktion', en: 'Function' },
  CustomFunction: { de: 'Eigene Funktion', en: 'Custom function' },
  CustomFunctionFolder: { de: 'Funktionsordner', en: 'Custom function folder' },
  ExternalDataSource: { de: 'Externe Datenquelle', en: 'External data source' },
  Field: { de: 'Feld', en: 'Field' },
  Folder: { de: 'Ordner', en: 'Folder' },
  Layout: { de: 'Layout', en: 'Layout' },
  LayoutFolder: { de: 'Layoutordner', en: 'Layout folder' },
  LayoutObject: { de: 'Layoutobjekt', en: 'Layout object' },
  LayoutPart: { de: 'Layoutbereich', en: 'Layout part' },
  PluginComponent: { de: 'MBS-Komponente', en: 'MBS component' },
  PluginFunction: { de: 'MBS-Funktion', en: 'MBS function' },
  PrivilegeSet: { de: 'Berechtigungsset', en: 'Privilege set' },
  Relationship: { de: 'Beziehung', en: 'Relationship' },
  RelationshipGraph: { de: 'Beziehungsdiagramm', en: 'Relationship graph' },
  Script: { de: 'Script', en: 'Script' },
  ScriptFolder: { de: 'Scriptordner', en: 'Script folder' },
  ScriptStep: { de: 'Scriptschritt', en: 'Script step' },
  ScriptStepType: { de: 'Scriptschritt', en: 'Script step' },
  TableOccurrence: { de: 'Tabellenauftreten', en: 'Table occurrence' },
  ValueList: { de: 'Werteliste', en: 'Value list' },
  Variable: { de: 'Variable', en: 'Variable' },
};

export function objectTypeLabel(type: string | null | undefined, language: UiLanguage = getUiLanguage()) {
  if (!type) return tx(language, 'Objekt', 'Object');
  const label = OBJECT_TYPE_LABELS[type];
  return label ? tx(language, label.de, label.en) : type;
}

export function refTypeLabel(type: string, language: UiLanguage = getUiLanguage()) {
  const labels: Record<string, { de: string; en: string }> = {
    customFunction: { de: 'Eigene Funktion', en: 'Custom function' },
    field: { de: 'Feld', en: 'Field' },
    function: { de: 'Funktion', en: 'Function' },
    layout: { de: 'Layout', en: 'Layout' },
    pluginFunction: { de: 'Plugin-Funktion', en: 'Plugin function' },
    script: { de: 'Script', en: 'Script' },
    tableOccurrence: { de: 'Tabellenauftreten', en: 'Table occurrence' },
    valueList: { de: 'Werteliste', en: 'Value list' },
    variable: { de: 'Variable', en: 'Variable' },
  };
  const label = labels[type];
  return label ? tx(language, label.de, label.en) : objectTypeLabel(type, language);
}
