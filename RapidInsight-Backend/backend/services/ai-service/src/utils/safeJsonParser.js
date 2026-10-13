function stripMarkdownFences(value) {
  return String(value || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseStrictJson(value) {
  if (value && typeof value === 'object') {
    return value;
  }

  const cleaned = stripMarkdownFences(value);

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const parseError = new Error('AI response was not valid JSON.');
    parseError.statusCode = 502;
    parseError.details = cleaned.slice(0, 1000);
    throw parseError;
  }
}

module.exports = {
  parseStrictJson
};
