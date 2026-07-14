import Anthropic from '@anthropic-ai/sdk';

/** Thin wrapper — deliberately not doing anything clever here. The
 * orchestrator (cli.ts) is the deterministic part; this is the one place
 * a stage calls out to a model, and it does exactly one thing: send a
 * prompt, get text back. All the actual judgment (does this need a
 * human? what does "verified" mean?) lives in the calling stage's code,
 * not buried in a prompt. */
export async function callClaude(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );
  return textBlocks.map((b) => b.text).join('\n');
}
