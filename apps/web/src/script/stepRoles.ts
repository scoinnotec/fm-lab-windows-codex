// Step-Name → Rolle Klassifizierung. Quelle: fm-lab-vscode stepRoles.json
// Wird clientseitig genutzt für View-Mode-Filterung und Step-Color-Klassen.

export type StepRole =
  | 'control-structure'
  | 'subscript-call'
  | 'variable-assignment'
  | 'field-assignment'
  | 'script-return'
  | 'navigation'
  | 'other';

const ROLE_MAP: Record<string, StepRole> = {};

const DATA: Record<Exclude<StepRole, 'other'>, string[]> = {
  'control-structure': [
    'If',
    'Else',
    'Else If',
    'End If',
    'Loop',
    'End Loop',
    'Exit Loop If',
    'Open Transaction',
    'Commit Transaction',
    'Revert Transaction',
  ],
  'subscript-call': [
    'Perform Script',
    'Perform Script on Server',
  ],
  'variable-assignment': [
    'Set Variable',
  ],
  'field-assignment': [
    'Set Field',
    'Set Field By Name',
    'Insert Calculated Result',
    'Insert from Index',
    'Insert from Last Visited',
    'Replace Field Contents',
  ],
  'script-return': [
    'Exit Script',
    'Halt Script',
  ],
  navigation: [
    'Go to Layout',
    'Go to Related Record',
    'Go to Record/Request/Page',
    'Go to Field',
    'Go to Object',
    'Go to Portal Row',
  ],
};

for (const [role, names] of Object.entries(DATA) as Array<[StepRole, string[]]>) {
  for (const name of names) ROLE_MAP[name] = role;
}

export function getStepRole(stepName: string | undefined): StepRole {
  if (!stepName) return 'other';
  return ROLE_MAP[stepName] ?? 'other';
}

// CSS-sicherer Klassen-Suffix für Step-Namen (z.B. "Set Variable" → "set-variable")
export function stepNameClass(stepName: string | undefined): string {
  if (!stepName) return 'unknown';
  return stepName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
