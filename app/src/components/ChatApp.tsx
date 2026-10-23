"use client";

import { useState } from "react";
import { DEPARTMENT_LIST, type DepartmentId } from "@/lib/departments";
import type { ChatMessage, ChatResponseBody } from "@/types/chat";
import { ChatWindow } from "./ChatWindow";

function initialGreeting(departmentId: DepartmentId): ChatMessage {
  const department = DEPARTMENT_LIST.find((d) => d.id === departmentId)!;
  return {
    role: "assistant",
    content: `你好,我是 ${department.name},可以協助你處理${department.tagline}相關問題。`,
  };
}

export function ChatApp() {
  const [activeDepartment, setActiveDepartment] = useState<DepartmentId>("hr");
  const [conversations, setConversations] = useState<Record<DepartmentId, ChatMessage[]>>({
    hr: [initialGreeting("hr")],
    sales: [initialGreeting("sales")],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [followUps, setFollowUps] = useState<Record<DepartmentId, string[]>>({
    hr: [],
    sales: [],
  });

  const messages = conversations[activeDepartment];
  const activeFollowUps = followUps[activeDepartment];

  async function sendMessage(content: string, options?: { fromFollowUp?: boolean }) {
    const fromFollowUp = options?.fromFollowUp === true;
    const userMessage: ChatMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setConversations((prev) => ({ ...prev, [activeDepartment]: nextMessages }));
    if (!fromFollowUp) {
      setFollowUps((prev) => ({ ...prev, [activeDepartment]: [] }));
    }
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: activeDepartment,
          messages: nextMessages,
          selectedFollowUp: fromFollowUp,
        }),
      });

      if (!res.ok) {
        throw new Error(`API 錯誤: ${res.status}`);
      }

      const data: ChatResponseBody = await res.json();
      setConversations((prev) => ({
        ...prev,
        [activeDepartment]: [...nextMessages, data.reply],
      }));
      setFollowUps((prev) => ({ ...prev, [activeDepartment]: data.followUps ?? [] }));
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `發生錯誤,請稍後再試。(${error instanceof Error ? error.message : "unknown error"})`,
      };
      setConversations((prev) => ({
        ...prev,
        [activeDepartment]: [...nextMessages, errorMessage],
      }));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-950">
      <header className="border-b border-black/10 px-6 py-4 dark:border-white/10">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Aster Machinery 部門 AI 助理
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          MVP 原型｜第一層規則把關 ＋ Claude API 回答
        </p>
      </header>

      <nav className="flex gap-1 border-b border-black/10 px-4 pt-3 dark:border-white/10">
        {DEPARTMENT_LIST.map((department) => (
          <button
            key={department.id}
            type="button"
            onClick={() => setActiveDepartment(department.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeDepartment === department.id
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {department.name}
          </button>
        ))}
      </nav>

      <ChatWindow
        department={DEPARTMENT_LIST.find((d) => d.id === activeDepartment)!}
        messages={messages}
        prompts={
          activeFollowUps.length > 0
            ? activeFollowUps
            : DEPARTMENT_LIST.find((d) => d.id === activeDepartment)!.suggestedPrompts
        }
        promptsAreFollowUps={activeFollowUps.length > 0}
        isLoading={isLoading}
        onSend={sendMessage}
      />
    </div>
  );
}
