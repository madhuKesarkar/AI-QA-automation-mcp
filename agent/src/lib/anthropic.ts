import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  // Model is account/region-specific (a Bedrock model ID or inference-profile
  // ARN) — never hardcode it. Configure BEDROCK_MODEL_ID in .env. loadConfig()
  // requires it, but guard here too since callClaude is the sole caller-facing
  // entry point.
  const model = process.env.BEDROCK_MODEL_ID;
  if (!model) {
    throw new Error(
      'BEDROCK_MODEL_ID is not set — export the Bedrock model ID or inference-profile ARN (see agent/.env.example).'
    );
  }

  const client = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION,
  });
  const response = await client.messages.create({
    model,
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn('[anthropic] WARNING: response was truncated by max_tokens — output may be incomplete');
  }

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('\n');
}