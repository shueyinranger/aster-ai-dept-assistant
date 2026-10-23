import { NextResponse } from "next/server";
import { isDepartmentId } from "@/lib/departments";
import { generateReply } from "@/lib/assistant";
import type { ChatRequestBody, ChatResponseBody } from "@/types/chat";

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤,需為 JSON" }, { status: 400 });
  }

  const { departmentId, messages, selectedFollowUp } = body;

  if (typeof departmentId !== "string" || !isDepartmentId(departmentId)) {
    return NextResponse.json({ error: "缺少或不支援的 departmentId" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages 不可為空" }, { status: 400 });
  }

  const { reply, followUps } = await generateReply(departmentId, messages, {
    answerDirectly: selectedFollowUp === true,
  });
  const response: ChatResponseBody = { reply, followUps };
  return NextResponse.json(response);
}
