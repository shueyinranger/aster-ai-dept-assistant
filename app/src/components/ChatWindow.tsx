"use client";

import { useState, type FormEvent } from "react";
import type { Department } from "@/lib/departments";
import type { ChatMessage } from "@/types/chat";

interface ChatWindowProps {
  department: Department;
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (content: string) => void;
}

export function ChatWindow({ department, messages, isLoading, onSend }: ChatWindowProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              思考中...
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-black/10 px-4 py-3 dark:border-white/10">
        <div className="mb-2 flex flex-wrap gap-2">
          {department.suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSend(prompt)}
              disabled={isLoading}
              className="rounded-full border border-black/10 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`向 ${department.name} 提問...`}
            className="flex-1 rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-zinc-400 dark:border-white/10 dark:focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={isLoading || !draft.trim()}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  );
}
