/**
 * Backend Provider
 *
 * LLM provider implementation that uses the backend WebSocket service
 * instead of making direct API calls.
 */

import { BaseLLMProvider } from '../llm/base';
import type { ChatModel } from '../../types/chat-model.types';
import type {
	LLMOptions,
	LLMRequestNonStreaming,
	LLMRequestStreaming,
} from '../../types/llm/request';
import type {
	LLMResponseNonStreaming,
	LLMResponseStreaming,
	ToolCallDelta,
} from '../../types/llm/response';
import type { BackendProviderConfig } from '../../types/provider.types';
import { formatToolResult } from './tool-result-formatter';
import type { WebSocketClient } from './WebSocketClient';

export class BackendProvider extends BaseLLMProvider<BackendProviderConfig> {
	constructor(
		provider: BackendProviderConfig,
		private wsClient: WebSocketClient
	) {
		super(provider);
	}

	/**
	 * Stream a response from the backend
	 */
	async streamResponse(
		model: ChatModel,
		request: LLMRequestStreaming,
		options?: LLMOptions
	): Promise<AsyncIterable<LLMResponseStreaming>> {
		if (!this.wsClient.isConnected) {
			throw new Error('Backend not connected');
		}

		// Convert request messages to a prompt string
		// The backend will handle the full conversation context
		const prompt = this.convertRequestToPrompt(request);

		// Extract system prompt from messages if present
		const systemMessage = request.messages.find((m) => m.role === 'system');
		const systemPrompt =
			systemMessage && typeof systemMessage.content === 'string'
				? systemMessage.content
				: undefined;

		// Create async generator to yield chunks
		const generator = this.createStreamGenerator(
			prompt,
			undefined,
			options,
			systemPrompt,
			model.model // Pass the model ID from settings
		);

		return generator;
	}

	/**
	 * Generate a non-streaming response (used for apply view)
	 */
	async generateResponse(
		model: ChatModel,
		request: LLMRequestNonStreaming,
		options?: LLMOptions
	): Promise<LLMResponseNonStreaming> {
		// For non-streaming, we collect all chunks and return final result
		const stream = await this.streamResponse(
			model,
			{ ...request, stream: true },
			options
		);

		let fullContent = '';
		let lastResponse: LLMResponseStreaming | null = null;

		for await (const chunk of stream) {
			lastResponse = chunk;
			const delta = chunk.choices[0]?.delta;
			if (delta?.content) {
				fullContent += delta.content;
			}
		}

		if (!lastResponse) {
			throw new Error('No response from backend');
		}

		// Convert final streaming response to non-streaming format
		return {
			id: lastResponse.id,
			object: 'chat.completion',
			created: Date.now(),
			model: model.model,
			choices: [
				{
					finish_reason: 'stop',
					message: {
						role: 'assistant',
						content: fullContent,
					},
				},
			],
			usage: lastResponse.usage,
		};
	}

	/**
	 * Get embedding for text (not yet supported by backend)
	 */
	async getEmbedding(model: string, text: string): Promise<number[]> {
		throw new Error(
			'Embeddings not yet supported by backend. Use local embedding provider.'
		);
	}

	/**
	 * Create an async generator that yields streaming chunks
	 */
	private async *createStreamGenerator(
		prompt: string,
		context?: { currentFile?: string; selection?: string },
		options?: LLMOptions,
		systemPrompt?: string,
		model?: string
	): AsyncGenerator<LLMResponseStreaming> {
		// State for accumulating responses
		const toolCalls: Map<
			number,
			{
				id: string;
				name: string;
				arguments: string;
				result?: string;
			}
		> = new Map();
		let isComplete = false;
		let errorOccurred = false;

		// Create a queue for messages
		const messageQueue: LLMResponseStreaming[] = [];
		let resolveNext: ((value: LLMResponseStreaming) => void) | null =
			null;

		// Helper to enqueue chunks
		const enqueueChunk = (chunk: LLMResponseStreaming) => {
			if (resolveNext) {
				resolveNext(chunk);
				resolveNext = null;
			} else {
				messageQueue.push(chunk);
			}
		};

		// Set up event handlers and send prompt
		const requestId = await this.wsClient.sendPrompt(
			prompt,
			{
				onTextDelta: (text: string) => {
					const chunk: LLMResponseStreaming = {
						id: requestId,
						object: 'chat.completion.chunk',
						model: 'backend',
						choices: [
							{
								delta: { content: text },
								finish_reason: null,
							},
						],
					};
					enqueueChunk(chunk);
				},

				onToolStart: (name: string, input: Record<string, unknown>) => {
					// Create a tool call entry with backend__ prefix for UI display
					const index = toolCalls.size;
					const toolId = `backend-${requestId}-${index}`;

					toolCalls.set(index, {
						id: toolId,
						name: `backend__${name}`, // Add prefix so UI knows it's from backend
						arguments: JSON.stringify(input),
					});

					// Send tool call delta to show in UI
					const toolDelta: ToolCallDelta = {
						index,
						id: toolId,
						type: 'function',
						function: {
							name: `backend__${name}`,
							arguments: JSON.stringify(input),
						},
					};

					enqueueChunk({
						id: requestId,
						object: 'chat.completion.chunk',
						model: 'backend',
						choices: [
							{
								delta: { tool_calls: [toolDelta] },
								finish_reason: null,
							},
						],
					});
				},

				onToolEnd: (name: string, result: string) => {
					// Store result and send it to UI as clickable file references
					for (const tool of Array.from(toolCalls.values())) {
						if (tool.name === `backend__${name}` && !tool.result) {
							tool.result = result;

							// Format tool results with clickable file references
							const formattedResult = formatToolResult(name, result, tool.arguments);

							// Only send formatted result if we have file references
							if (formattedResult) {
								enqueueChunk({
									id: requestId,
									object: 'chat.completion.chunk',
									model: 'backend',
									choices: [
										{
											delta: {
												content: `\n${formattedResult}\n`,
											},
											finish_reason: null,
										},
									],
								});
							}
							break;
						}
					}
				},

				onThinking: (text: string) => {
					const chunk: LLMResponseStreaming = {
						id: requestId,
						object: 'chat.completion.chunk',
						model: 'backend',
						choices: [
							{
								delta: { reasoning: text },
								finish_reason: null,
							},
						],
					};
					enqueueChunk(chunk);
				},

				onComplete: (result: string) => {
					const chunk: LLMResponseStreaming = {
						id: requestId,
						object: 'chat.completion.chunk',
						model: 'backend',
						choices: [
							{
								delta: {},
								finish_reason:
									toolCalls.size > 0 ? 'tool_calls' : 'stop',
							},
						],
						usage: {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0,
						},
					};
					isComplete = true;
					enqueueChunk(chunk);
				},

				onError: (code: string, message: string) => {
					console.error(
						`[BackendProvider] Error: ${code} - ${message}`
					);
					errorOccurred = true;
					isComplete = true;

					const chunk: LLMResponseStreaming = {
						id: requestId,
						object: 'chat.completion.chunk',
						model: 'backend',
						choices: [
							{
								delta: {},
								finish_reason: 'stop',
								error: { code: 500, message },
							},
						],
					};
					enqueueChunk(chunk);
				},
			},
			context,
			systemPrompt,
			model
		);

		// Yield chunks as they arrive
		while (!isComplete || messageQueue.length > 0) {
			if (messageQueue.length > 0) {
				yield messageQueue.shift()!;
			} else {
				// Wait for next chunk
				const chunk = await new Promise<LLMResponseStreaming>(
					(resolve) => {
						resolveNext = resolve;
					}
				);
				yield chunk;
			}

			// Check for abort
			if (options?.signal?.aborted) {
				this.wsClient.cancelRequest(requestId);
				break;
			}
		}

		if (errorOccurred) {
			throw new Error('Backend error occurred');
		}
	}

	/**
	 * Convert request messages to a simple prompt string
	 * The backend's agent will handle the full conversation context
	 */
	private convertRequestToPrompt(
		request: LLMRequestStreaming | LLMRequestNonStreaming
	): string {
		// For now, we'll send the entire message history as a JSON string
		// The backend can parse this and use it with the agent
		return JSON.stringify({
			messages: request.messages,
			tools: request.tools,
			tool_choice: request.tool_choice,
		});
	}
}
