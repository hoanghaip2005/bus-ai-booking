import { randomUUID } from 'node:crypto';

import { stepCountIs, streamText } from 'ai';
import { z } from 'zod';

import {
  AiSearchError,
  createLocalTripModel,
  createSearchTripsTool,
  parseTripQuestion,
} from '../../lib/ai-trip-assistant';
import {
  assessPromptSafety,
  createBookingLookupTool,
  createPolicyTool,
  createProtectedLocalModel,
  parseProtectedQuestion,
} from '../../lib/ai-protected-assistant';
import { AiRateLimitUnavailableError, consumeAiRateLimit } from '../../lib/ai-rate-limit';

export const runtime = 'nodejs';

const requestSchema = z.object({
  message: z.string().trim().min(3).max(500),
});
export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-request-id') ?? randomUUID();
  if (Number(request.headers.get('content-length') ?? 0) > 4_096) {
    return jsonError(413, 'VALIDATION_ERROR', 'Nội dung yêu cầu quá lớn.', requestId);
  }

  try {
    const searchSessionId = readUuid(request.headers.get('x-search-session-id'));
    const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const rateLimit = await consumeAiRateLimit(searchSessionId ?? forwardedIp ?? 'local');
    if (!rateLimit.allowed) {
      return jsonError(429, 'RATE_LIMITED', 'Bạn gửi quá nhanh. Vui lòng thử lại sau.', requestId, {
        'retry-after': String(rateLimit.retryAfterSeconds),
      });
    }
  } catch (error) {
    if (error instanceof AiRateLimitUnavailableError) {
      return jsonError(503, 'DEPENDENCY_UNAVAILABLE', 'Trợ lý đang tạm gián đoạn.', requestId);
    }
    throw error;
  }

  try {
    const body = requestSchema.parse(await request.json());
    const safety = assessPromptSafety(body.message);
    const protectedPlan = safety.safe
      ? parseProtectedQuestion(body.message)
      : { kind: 'safety' as const, refusal: safety.refusal };
    const parsed = protectedPlan ? undefined : parseTripQuestion(body.message);
    const searchSessionId = readUuid(request.headers.get('x-search-session-id')) ?? randomUUID();
    const selectedTool = protectedPlan
      ? protectedPlan.kind === 'safety'
        ? 'safetyRefusal'
        : protectedPlan.kind === 'booking'
          ? protectedPlan.input
            ? 'getBookingStatus'
            : 'privacyRefusal'
          : 'getPolicy'
      : 'searchTrips';
    const result = streamText({
      model: protectedPlan
        ? createProtectedLocalModel(protectedPlan)
        : createLocalTripModel(parsed!),
      system:
        'Bạn là trợ lý Bến Việt. Dữ liệu động chỉ đến từ typed tool. Không tiết lộ booking nếu thiếu mã booking hoặc email. Câu trả lời chính sách phải giữ nguyên citation từ tool.',
      prompt: body.message,
      tools: {
        searchTrips: createSearchTripsTool({ requestId, searchSessionId }),
        getBookingStatus: createBookingLookupTool({ requestId }),
        getPolicy: createPolicyTool(),
      },
      stopWhen: stepCountIs(2),
      onError: ({ error }) => {
        console.error(
          JSON.stringify({
            event: 'ai_chat_failed',
            requestId,
            code: error instanceof AiSearchError ? error.code : 'AI_STREAM_FAILED',
          }),
        );
      },
      onFinish: () => {
        console.info(
          JSON.stringify({
            event: 'ai_chat_completed',
            requestId,
            tool: selectedTool,
            messageLength: body.message.length,
            durationMs: Date.now() - startedAt,
          }),
        );
      },
    });

    return result.toTextStreamResponse({
      headers: {
        'cache-control': 'no-store',
        'x-request-id': requestId,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const code = error instanceof AiSearchError ? error.code : 'VALIDATION_ERROR';
    const message =
      error instanceof AiSearchError
        ? error.message
        : 'Câu hỏi chưa đúng định dạng. Hãy nêu điểm đi, điểm đến và ngày đi.';
    console.info(
      JSON.stringify({
        event: 'ai_chat_rejected',
        requestId,
        code,
        durationMs: Date.now() - startedAt,
      }),
    );
    return jsonError(400, code, message, requestId);
  }
}

function readUuid(value: string | null): string | undefined {
  return value && z.string().uuid().safeParse(value).success ? value : undefined;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extraHeaders },
    },
  );
}
