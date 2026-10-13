const grokProvider = require('./grokProvider');
const openaiProvider = require('./openaiProvider');
const azureOpenAIProvider = require('./azureOpenAIProvider');
const claudeProvider = require('./claudeProvider');
const geminiProvider = require('./geminiProvider');

const groqProvider = require('./groqProvider');

function getAiProvider() {
  const provider = String(process.env.AI_PROVIDER || 'grok').toLowerCase();

  switch (provider) {
    case 'grok':
    case 'xai':
      return grokProvider;

    case 'groq':
      return groqProvider;

    case 'openai':
      return openaiProvider;

    case 'azure-openai':
    case 'azure_openai':
    case 'azure':
      return azureOpenAIProvider;

    case 'claude':
    case 'anthropic':
      return claudeProvider;

    case 'gemini':
    case 'google':
      return geminiProvider;

    default:
      throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }
}

module.exports = {
  getAiProvider
};
