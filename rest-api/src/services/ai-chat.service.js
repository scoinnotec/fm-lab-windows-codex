const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const environment = require('../config/environment');
const { createError } = require('../middleware/error-handler');
const providers = require('./ai/provider-registry');

const MAX_HISTORY_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 24000;
const RETENTION_CHECK_INTERVAL_MS = 15 * 60 * 1000;
let lastRetentionCheckAt = 0;

function normalizeValue(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === 'object') {
    const normalized = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeValue(nested);
    }
    return normalized;
  }
  return value;
}

function chatRoot() {
  const configured = environment.ai.chatsDir;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(__dirname, '../../', configured);
}

async function ensureChatRoot() {
  await fs.mkdir(chatRoot(), { recursive: true });
}

function chatRetentionMs() {
  const days = Math.max(0, Number(environment.ai.chatRetentionDays || 0));
  return days > 0 ? days * 24 * 60 * 60 * 1000 : 0;
}

function maxConversationCount() {
  return Math.max(1, Number(environment.ai.chatMaxConversations || 200));
}

function maxMessageCount() {
  return Math.max(2, Number(environment.ai.chatMaxMessages || 60));
}

function maxConversationFileBytes() {
  return Math.max(8192, Number(environment.ai.chatMaxFileBytes || 1048576));
}

function assertSafeId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id || ''))) {
    throw createError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found.');
  }
}

function conversationPath(id) {
  assertSafeId(id);
  return path.join(chatRoot(), `${id}.json`);
}

function createMessage(role, content, extra = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content: String(content || '').slice(0, MAX_MESSAGE_CHARS),
    created_at: new Date().toISOString(),
    ...extra,
  };
}

function trimConversation(conversation) {
  const normalized = normalizeValue(conversation);
  const messages = Array.isArray(normalized.messages) ? normalized.messages : [];
  normalized.messages = messages.slice(-maxMessageCount());
  return normalized;
}

function serializeConversation(conversation) {
  const normalized = trimConversation(conversation);
  let payload = JSON.stringify(normalized, null, 2);
  const maxBytes = maxConversationFileBytes();

  while (Buffer.byteLength(payload, 'utf8') > maxBytes && normalized.messages.length > 2) {
    normalized.messages.shift();
    payload = JSON.stringify(normalized, null, 2);
  }

  if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
    normalized.messages = normalized.messages.map((message) => ({
      ...message,
      content: String(message.content || '').slice(0, Math.floor(MAX_MESSAGE_CHARS / 2)),
    }));
    payload = JSON.stringify(normalized, null, 2);
  }

  return { conversation: normalized, payload };
}

async function cleanupChatStorage({ force = false } = {}) {
  await ensureChatRoot();
  const now = Date.now();
  if (!force && now - lastRetentionCheckAt < RETENTION_CHECK_INTERVAL_MS) {
    return { deleted: 0, checked: false };
  }
  lastRetentionCheckAt = now;

  const retentionMs = chatRetentionMs();
  const maxBytes = maxConversationFileBytes();
  const entries = await fs.readdir(chatRoot(), { withFileTypes: true });
  const files = [];
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const fullPath = path.join(chatRoot(), entry.name);
    try {
      const stat = await fs.stat(fullPath);
      const tooOld = retentionMs > 0 && now - stat.mtimeMs > retentionMs;
      const tooLarge = stat.size > maxBytes;
      if (tooOld || tooLarge) {
        await fs.unlink(fullPath);
        deleted += 1;
        continue;
      }
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // Einzelne defekte Dateien blockieren die Retention nicht.
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of files.slice(maxConversationCount())) {
    try {
      await fs.unlink(stale.path);
      deleted += 1;
    } catch {
      // Best effort cleanup.
    }
  }

  return { deleted, checked: true };
}

async function readConversation(id) {
  await ensureChatRoot();
  try {
    const raw = await fs.readFile(conversationPath(id), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found.', { id });
    }
    throw error;
  }
}

async function writeConversation(conversation) {
  await ensureChatRoot();
  const serialized = serializeConversation(conversation);
  await fs.writeFile(conversationPath(serialized.conversation.id), serialized.payload, 'utf8');
  await cleanupChatStorage();
  return serialized.conversation;
}

function toSummary(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    provider: conversation.provider,
    model: conversation.model,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    message_count: conversation.messages?.length || 0,
  };
}

async function listConversations() {
  await ensureChatRoot();
  await cleanupChatStorage();
  const entries = await fs.readdir(chatRoot(), { withFileTypes: true });
  const conversations = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(chatRoot(), entry.name), 'utf8');
      conversations.push(toSummary(JSON.parse(raw)));
    } catch {
      // Defekte Einzeldateien sollen die Chatliste nicht blockieren.
    }
  }

  conversations.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return conversations;
}

async function createConversation({ title, provider, model }) {
  const providerId = providers.normalizeProvider(provider);
  const providerInfo = providers.getProvider(providerId).provider.getInfo();
  const now = new Date().toISOString();
  const conversation = {
    id: crypto.randomUUID(),
    title: String(title || 'Neue Datenbank-Frage').trim().slice(0, 160),
    provider: providerId,
    model: String(model || providerInfo.default_model || '').trim(),
    created_at: now,
    updated_at: now,
    messages: [],
  };

  return writeConversation(conversation);
}

async function objectOrViewExists(name) {
  const result = await db.executeQuery(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT table_name AS name FROM duckdb_tables()
      UNION ALL
      SELECT view_name AS name FROM duckdb_views()
    )
    WHERE lower(name) = lower(?)
  `, [name]);

  return Number(result.rows[0]?.count || 0) > 0;
}

async function queryIfExists(name, sql, params = []) {
  try {
    if (!(await objectOrViewExists(name))) return [];
    const result = await db.executeQuery(sql, params);
    return normalizeValue(result.rows);
  } catch {
    return [];
  }
}

function extractSearchTerms(question) {
  const terms = String(question || '')
    .match(/[\p{L}\p{N}_$.-]{3,}/gu) || [];
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 6);
}

function addSection(sections, title, rows, description = '', options = {}) {
  if ((!rows || rows.length === 0) && !options.includeEmpty) return;
  sections.push({
    title,
    description,
    rows: rows || [],
  });
}

function parseGlobalVariableThreshold(question) {
  const text = String(question || '').toLowerCase();
  if (!text.includes('$$')) return null;
  if (!/(script|skript)/i.test(text)) return null;
  if (!/(variable|variablen)/i.test(text)) return null;
  const match = text.match(/(?:mehr als|ueber|über|>\s*)\s*(\d+)/i);
  return match ? Number(match[1]) : 10;
}

function parseScriptPrefix(question) {
  const text = String(question || '').trim();
  const patterns = [
    /(?:script|skript)s?.{0,40}mit\s+["'`]?([A-Za-z0-9_$.-]{2,})["'`]?\s+(?:beginnen|anfangen|starten)/i,
    /(?:script|skript)s?.{0,40}(?:beginnen|anfangen|starten)\s+mit\s+["'`]?([A-Za-z0-9_$.-]{2,})["'`]?/i,
    /(?:script|skript)s?.{0,40}prefix\s+["'`]?([A-Za-z0-9_$.-]{2,})["'`]?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[?.,;:]+$/, '');
  }
  return null;
}

async function addIntentSpecificContext(sections, question) {
  const threshold = parseGlobalVariableThreshold(question);
  if (threshold !== null) {
    const rows = await queryIfExists('StepsForScripts', `
      WITH global_variable_steps AS (
        SELECT
          File_Name,
          Script_UUID,
          Script_Name,
          Step_Index + 1 AS Step_Number,
          Step_Name,
          Variable_Name
        FROM StepsForScripts
        WHERE Variable_Name LIKE '$$%'
      )
      SELECT
        File_Name,
        Script_UUID,
        Script_Name,
        COUNT(*) AS Global_Variable_Set_Steps,
        COUNT(DISTINCT Variable_Name) AS Distinct_Global_Variables,
        string_agg(DISTINCT Variable_Name, ', ' ORDER BY Variable_Name) AS Global_Variable_Names,
        string_agg(CAST(Step_Number AS VARCHAR), ', ' ORDER BY Step_Number) AS Step_Numbers
      FROM global_variable_steps
      GROUP BY File_Name, Script_UUID, Script_Name
      HAVING COUNT(DISTINCT Variable_Name) > ? OR COUNT(*) > ?
      ORDER BY Distinct_Global_Variables DESC, Global_Variable_Set_Steps DESC, lower(Script_Name)
      LIMIT 80
    `, [threshold, threshold]);

    addSection(
      sections,
      `Exact analysis: scripts with more than ${threshold} global variables`,
      rows,
      'Exact DuckDB query on StepsForScripts.Variable_Name LIKE "$$%". Empty rows means no matching scripts were found.',
      { includeEmpty: true }
    );
  }

  const scriptPrefix = parseScriptPrefix(question);
  if (scriptPrefix) {
    const rows = await queryIfExists('ObjectCatalog', `
      SELECT
        File_Name,
        Object_UUID AS Script_UUID,
        Object_Name AS Script_Name,
        Source_Table
      FROM ObjectCatalog
      WHERE Object_Type = 'Script'
        AND Object_Name ILIKE ?
      ORDER BY File_Name, lower(Object_Name)
      LIMIT 120
    `, [`${scriptPrefix}%`]);

    addSection(
      sections,
      `Exact analysis: scripts starting with ${scriptPrefix}`,
      rows,
      `Exact DuckDB query on ObjectCatalog for Script names beginning with "${scriptPrefix}". Empty rows means no matching scripts were found.`,
      { includeEmpty: true }
    );
  }
}

async function buildDatabaseContext(question) {
  const sections = [];
  const maxRows = Math.max(10, Math.min(Number(environment.ai.maxContextRows) || 40, 120));

  await addIntentSpecificContext(sections, question);

  addSection(
    sections,
    'Object type counts',
    await queryIfExists('ObjectCatalog', `
      SELECT Object_Type, COUNT(*) AS Object_Count
      FROM ObjectCatalog
      GROUP BY Object_Type
      ORDER BY Object_Count DESC, Object_Type
      LIMIT 30
    `),
    'High-level inventory from ObjectCatalog.'
  );

  addSection(
    sections,
    'File counts',
    await queryIfExists('ObjectCatalog', `
      SELECT File_Name, COUNT(*) AS Object_Count
      FROM ObjectCatalog
      WHERE File_Name IS NOT NULL
      GROUP BY File_Name
      ORDER BY Object_Count DESC, File_Name
      LIMIT 20
    `),
    'Imported FileMaker files and object counts.'
  );

  addSection(
    sections,
    'Quality findings',
    await queryIfExists('QualityFindings', `
      SELECT Area, Issue_Category, Severity, COUNT(*) AS Finding_Count
      FROM QualityFindings
      GROUP BY Area, Issue_Category, Severity
      ORDER BY Finding_Count DESC, Area, Issue_Category, Severity
      LIMIT 30
    `),
    'Aggregated quality and reference findings.'
  );

  addSection(
    sections,
    'Layout object quality',
    await queryIfExists('LayoutObjectQualityFindings', `
      SELECT Issue_Category, Issue_Type, Severity, COUNT(*) AS Finding_Count
      FROM LayoutObjectQualityFindings
      GROUP BY Issue_Category, Issue_Type, Severity
      ORDER BY Finding_Count DESC, Issue_Category, Issue_Type
      LIMIT 30
    `),
    'Aggregated layout-object issues.'
  );

  addSection(
    sections,
    'API and external integrations',
    await queryIfExists('ApiIntegrationSummary', `
      SELECT Integration_Type, Api_Family, Api_Name, Finding_Count, Source_Count, Step_Count, Secret_Count
      FROM ApiIntegrationSummary
      ORDER BY Finding_Count DESC, Source_Count DESC, lower(Api_Family)
      LIMIT 30
    `),
    'Sanitized summary without raw credentials.'
  );

  addSection(
    sections,
    'Server top-call optimization candidates',
    await queryIfExists('ServerTopCallOptimizationSummary', `
      SELECT
        Object_Type,
        Object_Name,
        File_Name,
        Related_TO_Name,
        Related_Table_Name,
        Call_Count,
        Total_Elapsed_Milliseconds,
        Max_Elapsed_Milliseconds,
        Wait_Time_Milliseconds,
        IO_Time_Milliseconds,
        Operations,
        Optimization_Hint
      FROM ServerTopCallOptimizationSummary
      ORDER BY Total_Elapsed_Microseconds DESC, Max_Elapsed_Microseconds DESC
      LIMIT 30
    `),
    'Imported FileMaker Server TopCallStats hotspots matched to fields/layouts.'
  );

  addSection(
    sections,
    'Table occurrence usage extremes',
    await queryIfExists('TableOccurrenceUsageSummary', `
      WITH ranked AS (
        SELECT
          TO_Name,
          File_Name,
          BT_Name,
          Usage_Count,
          Functional_Usage_Count,
          Relationship_Count,
          ROW_NUMBER() OVER (ORDER BY Usage_Count ASC, lower(TO_Name)) AS low_rank,
          ROW_NUMBER() OVER (ORDER BY Usage_Count DESC, lower(TO_Name)) AS high_rank
        FROM TableOccurrenceUsageSummary
      )
      SELECT TO_Name, File_Name, BT_Name, Usage_Count, Functional_Usage_Count, Relationship_Count
      FROM ranked
      WHERE low_rank <= 15 OR high_rank <= 15
      ORDER BY Usage_Count ASC, lower(TO_Name)
      LIMIT 30
    `),
    'Least and most referenced table occurrences.'
  );

  const terms = extractSearchTerms(question);
  const objectMatches = [];
  for (const term of terms) {
    const rows = await queryIfExists('ObjectCatalog', `
      SELECT Object_Type, Object_Name, File_Name, Source_Table
      FROM ObjectCatalog
      WHERE Object_Name ILIKE ?
         OR Object_Type ILIKE ?
         OR File_Name ILIKE ?
      ORDER BY lower(Object_Type), lower(Object_Name)
      LIMIT ?
    `, [`%${term}%`, `%${term}%`, `%${term}%`, Math.ceil(maxRows / Math.max(1, terms.length))]);
    objectMatches.push(...rows);
  }

  const seenObjects = new Set();
  addSection(
    sections,
    'Object matches for the question',
    objectMatches.filter((row) => {
      const key = `${row.Object_Type}|${row.File_Name}|${row.Object_Name}`;
      if (seenObjects.has(key)) return false;
      seenObjects.add(key);
      return true;
    }).slice(0, maxRows),
    'Name/type/file matches extracted from the user question.'
  );

  if (terms.length > 0) {
    const scriptRows = [];
    for (const term of terms.slice(0, 4)) {
      const rows = await queryIfExists('StepsForScripts', `
        SELECT
          Script_Name,
          Step_Index + 1 AS Step_Number,
          Step_Name,
          Variable_Name,
          substr(COALESCE(Calculation_Text, ''), 1, 500) AS Calculation_Text,
          File_Name
        FROM StepsForScripts
        WHERE Script_Name ILIKE ?
           OR Step_Name ILIKE ?
           OR Variable_Name ILIKE ?
           OR Calculation_Text ILIKE ?
        ORDER BY lower(Script_Name), Step_Index
        LIMIT ?
      `, [`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`, Math.ceil(maxRows / Math.min(4, terms.length))]);
      scriptRows.push(...rows);
    }

    const seenScripts = new Set();
    addSection(
      sections,
      'Script-step matches for the question',
      scriptRows.filter((row) => {
        const key = `${row.File_Name}|${row.Script_Name}|${row.Step_Number}|${row.Step_Name}`;
        if (seenScripts.has(key)) return false;
        seenScripts.add(key);
        return true;
      }).slice(0, maxRows),
      'Relevant script-step rows. Long calculations are shortened.'
    );
  }

  const contextText = sections.map((section) => {
    const rows = JSON.stringify(section.rows, null, 2);
    return `## ${section.title}\n${section.description}\n${rows}`;
  }).join('\n\n');

  return {
    generated_at: new Date().toISOString(),
    section_count: sections.length,
    sections,
    text: contextText || 'No database context could be loaded.',
  };
}

function buildSystemPrompt(databaseContext) {
  return [
    'Du bist ein AI-Assistent fuer die Analyse einer FileMaker-Datenbank, die aus SaveAsXML in DuckDB importiert wurde.',
    'Antworte in der Sprache der letzten Nutzerfrage.',
    'Nutze den bereitgestellten Datenbankkontext als Grundlage und trenne belegte Fakten klar von Vermutungen.',
    'Wenn ein Abschnitt mit "Exact analysis:" vorhanden ist, behandle ihn als primaere Quelle und beantworte die Frage konkret mit den gefundenen Zeilen oder sage klar, dass keine Zeilen gefunden wurden.',
    'Schlage keine SQL-Abfragen vor, wenn der bereitgestellte Kontext die Nutzerfrage bereits direkt beantwortet.',
    'Erfinde keine FileMaker-Funktionen, Scriptschritte, Script-Trigger, Syntax oder Fehlercodes.',
    'Wenn der Kontext nicht reicht, sage konkret, welche weitere Analyse oder welcher Suchbegriff fehlt.',
    'Formuliere Hinweise so, dass sie fuer Dokumentation, Refactoring, Optimierung oder Programmierung weiterverwendbar sind.',
    'Keine Zugangsdaten, Tokens oder Passwoerter ausgeben. Wenn Zugangsdaten relevant sind, nur Kategorie, Fundortart und Risiko nennen.',
    '',
    'Datenbankkontext:',
    databaseContext.text,
  ].join('\n');
}

function recentMessages(messages) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, MAX_MESSAGE_CHARS),
    }));
}

async function sendMessage(id, { message, provider, model, credentials }) {
  const content = String(message || '').trim();
  if (!content) {
    throw createError('VALIDATION_ERROR', 'Message is required.');
  }

  const conversation = await readConversation(id);
  const providerId = providers.normalizeProvider(provider || conversation.provider);
  const modelName = String(model || conversation.model || '').trim();
  const userMessage = createMessage('user', content);
  conversation.messages.push(userMessage);

  const databaseContext = await buildDatabaseContext(content);
  const assistantResult = await providers.generate({
    provider: providerId,
    model: modelName || undefined,
    systemPrompt: buildSystemPrompt(databaseContext),
    messages: recentMessages(conversation.messages),
    credentials,
  });

  conversation.provider = assistantResult.provider;
  conversation.model = assistantResult.model;
  conversation.updated_at = new Date().toISOString();
  if (!conversation.title || conversation.title === 'Neue Datenbank-Frage') {
    conversation.title = content.slice(0, 80);
  }

  const assistantMessage = createMessage('assistant', assistantResult.content, {
    context: {
      generated_at: databaseContext.generated_at,
      sections: databaseContext.sections.map((section) => ({
        title: section.title,
        row_count: section.rows.length,
      })),
    },
  });
  conversation.messages.push(assistantMessage);
  const savedConversation = await writeConversation(conversation);

  return {
    conversation: savedConversation,
    message: assistantMessage,
    context: assistantMessage.context,
  };
}

function conversationToMarkdown(conversation) {
  const lines = [
    `# ${conversation.title || 'AI database chat'}`,
    '',
    `- Provider: ${conversation.provider || ''}`,
    `- Model: ${conversation.model || ''}`,
    `- Created: ${conversation.created_at || ''}`,
    `- Updated: ${conversation.updated_at || ''}`,
    '',
  ];

  for (const message of conversation.messages || []) {
    const label = message.role === 'assistant' ? 'Assistant' : 'User';
    lines.push(`## ${label}`);
    lines.push('');
    lines.push(String(message.content || '').trim());
    lines.push('');

    if (message.role === 'assistant' && message.context?.sections?.length) {
      lines.push('<details>');
      lines.push('<summary>Database context used</summary>');
      lines.push('');
      for (const section of message.context.sections) {
        lines.push(`- ${section.title}: ${section.row_count} rows`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

async function exportMarkdown(id) {
  const conversation = await readConversation(id);
  return conversationToMarkdown(conversation);
}

async function deleteConversation(id) {
  await ensureChatRoot();
  try {
    await fs.unlink(conversationPath(id));
    return { deleted: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw createError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found.', { id });
    }
    throw error;
  }
}

module.exports = {
  listConversations,
  createConversation,
  readConversation,
  sendMessage,
  exportMarkdown,
  deleteConversation,
  cleanupChatStorage,
  listProviders: providers.listProviders,
};
