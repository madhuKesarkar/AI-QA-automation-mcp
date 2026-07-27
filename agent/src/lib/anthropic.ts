import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION,
  });
  const response = await client.messages.create({
    model: 'arn:aws:bedrock:us-east-1:563410114716:application-inference-profile/319ktwmxzths',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => ('text' in block ? block.text : ''))
    .join('\n');
}