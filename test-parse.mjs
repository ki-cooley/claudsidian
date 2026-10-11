import { z } from 'zod';
import fs from 'fs';

// Import the actual schema components
const baseLlmProviderSchema = z.object({
  id: z.string().min(1, 'id is required'),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  additionalSettings: z.record(z.string(), z.string()).optional(),
});

const llmProviderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('openai'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('anthropic'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('gemini'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('deepseek'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('perplexity'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('groq'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('mistral'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('openrouter'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('ollama'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('lm-studio'), ...baseLlmProviderSchema.shape }),
  z.object({ type: z.literal('morph'), ...baseLlmProviderSchema.shape }),
  z.object({
    type: z.literal('azure-openai'),
    ...baseLlmProviderSchema.shape,
    additionalSettings: z.object({
      deployment: z.string().min(1),
      apiVersion: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('openai-compatible'),
    ...baseLlmProviderSchema.shape,
    baseUrl: z.string().min(1),
    additionalSettings: z.object({ noStainless: z.boolean().optional() }).optional(),
  }),
  z.object({
    type: z.literal('backend'),
    id: z.string().min(1),
    backendUrl: z.string().min(1),
    authToken: z.string().min(1),
  }),
]);

// Read the actual data.json
const dataPath = '/Users/kicooley-winters/yes-chef-test/.obsidian/plugins/claudsidian/data.json';
const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

console.log('Testing providers parsing...');
console.log('Raw providers:', rawData.providers?.map(p => ({ type: p.type, id: p.id })));

try {
  const result = z.array(llmProviderSchema).parse(rawData.providers);
  console.log('SUCCESS! Parsed providers:', result.map(p => ({ type: p.type, id: p.id })));
  const backend = result.find(p => p.type === 'backend');
  console.log('Backend provider:', backend ? 'FOUND' : 'NOT FOUND');
  if (backend && backend.type === 'backend') {
    console.log('  backendUrl:', backend.backendUrl ? 'SET' : 'EMPTY');
    console.log('  authToken:', backend.authToken ? 'SET' : 'EMPTY');
  }
} catch (err) {
  console.log('PARSING FAILED!');
  console.log('Error:', err.message);
  if (err.errors) {
    console.log('Validation errors:', JSON.stringify(err.errors, null, 2));
  }
}
