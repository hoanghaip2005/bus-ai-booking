'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const example = 'Ngày 20/06/2030 có xe từ Sài Gòn đi Đà Lạt không?';

const suggestions = [
  {
    label: 'Xe đi Đà Lạt tối mai',
    prompt: 'Tối mai có xe từ Sài Gòn đi Đà Lạt không?',
  },
  {
    label: 'Chính sách hủy vé',
    prompt: 'Chính sách hủy vé như thế nào?',
  },
  {
    label: 'Cách tra cứu booking',
    prompt: 'Tôi cần cung cấp gì để tra cứu trạng thái booking?',
  },
] as const;

export function AiTripChat({ standalone = false }: { standalone?: boolean }) {
  const [input, setInput] = useState(example);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle');
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, status]);

  async function ask(message: string) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage || status === 'streaming') return;
    let receivedText = '';

    setMessages((current) => [...current, { role: 'user', text: normalizedMessage }]);
    setInput('');
    setError('');
    setStatus('streaming');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-search-session-id': getSearchSessionId(),
        },
        body: JSON.stringify({ message: normalizedMessage }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? 'Trợ lý đang tạm gián đoạn.');
      }

      setMessages((current) => [...current, { role: 'assistant', text: '' }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        receivedText += text;
        setMessages((current) => {
          const next = [...current];
          const last = next.at(-1);
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, text: last.text + text };
          }
          return next;
        });
      }
      const trailingText = decoder.decode();
      if (trailingText) {
        receivedText += trailingText;
        setMessages((current) => {
          const next = [...current];
          const last = next.at(-1);
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, text: last.text + trailingText };
          }
          return next;
        });
      }
      if (!receivedText.trim()) throw new Error('Trợ lý chưa nhận được dữ liệu trả lời.');
      setStatus('idle');
    } catch (caught) {
      setMessages((current) => {
        const last = current.at(-1);
        return last?.role === 'assistant' && !last.text ? current.slice(0, -1) : current;
      });
      setInput(normalizedMessage);
      setError(caught instanceof Error ? caught.message : 'Trợ lý đang tạm gián đoạn.');
      setStatus('error');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void ask(input);
  }

  const Heading = standalone ? 'h1' : 'h2';

  return (
    <section
      className={`ai-chat${standalone ? ' ai-chat-standalone' : ''}`}
      id="ai-assistant"
      aria-labelledby="ai-chat-title"
    >
      <div className="ai-chat-intro">
        <div className="ai-chat-kicker">
          <span aria-hidden="true" />
          Trợ lý đặt vé trực tuyến
        </div>
        <p className="eyebrow">Bến Việt đồng hành cùng bạn</p>
        <Heading id="ai-chat-title">Hỏi một câu, tìm đúng chuyến.</Heading>
        <p>
          Tìm xe bằng ngôn ngữ tự nhiên, xem chính sách hoặc kiểm tra trạng thái booking mà không
          phải dò qua nhiều màn hình.
        </p>
        <ul className="ai-chat-capabilities" aria-label="Trợ lý có thể hỗ trợ">
          <li>
            <span aria-hidden="true">01</span>
            <div>
              <strong>Tìm chuyến phù hợp</strong>
              <small>Theo nơi đi, nơi đến và ngày khởi hành.</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">02</span>
            <div>
              <strong>Giải thích chính sách</strong>
              <small>Câu trả lời luôn kèm nguồn tham chiếu.</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">03</span>
            <div>
              <strong>Tra cứu booking an toàn</strong>
              <small>Cần đúng mã booking và email đã đặt vé.</small>
            </div>
          </li>
        </ul>
      </div>

      <div className="ai-chat-console">
        <header className="ai-chat-header">
          <div className="ai-chat-identity">
            <span className="ai-chat-avatar" aria-hidden="true">
              BV
            </span>
            <div>
              <strong>Trợ lý Bến Việt</strong>
              <span>
                <i aria-hidden="true" /> TRỢ LÝ ĐANG TRỰC TUYẾN
              </span>
            </div>
          </div>
          <button
            className="ai-chat-clear"
            type="button"
            disabled={messages.length === 0 || status === 'streaming'}
            onClick={() => {
              setMessages([]);
              setError('');
              setInput(example);
              setStatus('idle');
            }}
          >
            Xóa hội thoại
          </button>
        </header>

        <div className="ai-chat-suggestions" aria-label="Câu hỏi gợi ý">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={status === 'streaming'}
              onClick={() => void ask(suggestion.prompt)}
            >
              {suggestion.label}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>

        <div
          ref={messagesRef}
          className="ai-chat-messages"
          role="log"
          aria-live="polite"
          aria-busy={status === 'streaming'}
          aria-label="Nội dung hội thoại"
        >
          {messages.length === 0 ? (
            <div className="ai-chat-welcome">
              <span className="ai-chat-welcome-mark" aria-hidden="true">
                ✦
              </span>
              <strong>Xin chào, bạn muốn đi đâu?</strong>
              <p>Mô tả chuyến đi bằng một câu. Ví dụ: “{example}”</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
                <span className="ai-message-avatar" aria-hidden="true">
                  {message.role === 'user' ? 'B' : 'BV'}
                </span>
                <div className="ai-message-content">
                  <span className="ai-message-author">
                    {message.role === 'user' ? 'Bạn' : 'Trợ lý Bến Việt'}
                  </span>
                  <p>
                    {message.text ? (
                      <ChatAnswer text={message.text} />
                    ) : (
                      <span className="ai-typing" aria-label="Đang tìm thông tin">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>

        {error ? (
          <p className="ai-chat-error" role="alert">
            <strong>Chưa thể trả lời.</strong> {error}
          </p>
        ) : null}

        <form className="ai-chat-form" onSubmit={submit}>
          <label htmlFor="ai-question">Câu hỏi tìm chuyến</label>
          <div className="ai-chat-composer">
            <textarea
              id="ai-question"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              maxLength={500}
              rows={2}
              placeholder="Ví dụ: Tối mai có xe từ Sài Gòn đi Đà Lạt không?"
            />
            <button
              type="submit"
              aria-label="Gửi câu hỏi"
              disabled={!input.trim() || status === 'streaming'}
            >
              <span>{status === 'streaming' ? 'Đang tìm' : 'Gửi câu hỏi'}</span>
              <span className="ai-chat-send-icon" aria-hidden="true">
                ↑
              </span>
            </button>
          </div>
          <div className="ai-chat-form-meta">
            <span>Enter để gửi · Shift + Enter để xuống dòng</span>
            <span>{input.length}/500</span>
          </div>
        </form>
      </div>
    </section>
  );
}

function ChatAnswer({ text }: { text: string }) {
  const parts = text.split(/(\/trips\/[0-9a-f-]{36}|bus:\/\/[a-z0-9/_-]+)/giu);
  return parts.map((part, index) => {
    if (/^\/trips\/[0-9a-f-]{36}$/iu.test(part)) {
      return (
        <Link
          href={part}
          key={`${part}-${index}`}
          aria-label={`Xem chi tiết chuyến ${part.slice('/trips/'.length)}`}
        >
          Xem chuyến
        </Link>
      );
    }
    if (/^bus:\/\//iu.test(part)) {
      return <code key={`${part}-${index}`}>{part}</code>;
    }
    return part;
  });
}

function getSearchSessionId(): string {
  const key = 'bus-search-session-id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}
