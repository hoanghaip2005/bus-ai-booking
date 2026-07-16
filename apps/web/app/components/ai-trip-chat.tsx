'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const example = 'Ngày 20/06/2030 có xe từ Sài Gòn đi Đà Lạt không?';

export function AiTripChat() {
  const [input, setInput] = useState(example);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || status === 'streaming') return;

    setMessages((current) => [...current, { role: 'user', text: message }]);
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
        body: JSON.stringify({ message }),
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
        setMessages((current) => {
          const next = [...current];
          const last = next.at(-1);
          if (last?.role === 'assistant')
            next[next.length - 1] = { ...last, text: last.text + text };
          return next;
        });
      }
      setStatus('idle');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Trợ lý đang tạm gián đoạn.');
      setStatus('error');
    }
  }

  return (
    <section className="ai-chat" id="ai-assistant" aria-labelledby="ai-chat-title">
      <div className="ai-chat-intro">
        <p className="eyebrow">Trợ lý hành trình · AI SDK</p>
        <h2 id="ai-chat-title">Hỏi như đang nhắn cho một người quen đường.</h2>
        <p>
          Trợ lý chỉ trả lời dữ liệu có thật từ hệ thống, có thể tìm chuyến, giải thích chính sách
          có nguồn và tra cứu booking khi bạn cung cấp đủ mã booking cùng email.
        </p>
      </div>

      <div className="ai-chat-console">
        <div className="ai-chat-status">
          <span aria-hidden="true" />
          <strong>VERIFIED TOOLS ONLINE</strong>
          <small>Search · Booking · Policy</small>
        </div>
        <div className="ai-chat-messages" aria-live="polite" aria-busy={status === 'streaming'}>
          {messages.length === 0 ? (
            <p className="ai-chat-empty">Thử hỏi: “{example}”</p>
          ) : (
            messages.map((message, index) => (
              <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
                <span>{message.role === 'user' ? 'Bạn' : 'Bến Việt AI'}</span>
                <p>{message.text || 'Đang đối chiếu lịch chạy...'}</p>
              </div>
            ))
          )}
        </div>
        <form className="ai-chat-form" onSubmit={submit}>
          <label htmlFor="ai-question">Câu hỏi tìm chuyến</label>
          <div>
            <input
              id="ai-question"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={500}
              placeholder="Tối mai có xe từ Sài Gòn đi Đà Lạt không?"
            />
            <button type="submit" disabled={!input.trim() || status === 'streaming'}>
              {status === 'streaming' ? 'Đang tìm...' : 'Gửi hỏi'}
            </button>
          </div>
        </form>
        {error ? <p className="ai-chat-error">{error}</p> : null}
      </div>
    </section>
  );
}

function getSearchSessionId(): string {
  const key = 'bus-search-session-id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}
