import fs from "node:fs";
import path from "node:path";
import { DEPARTMENTS, type DepartmentId } from "./departments";

// The `ai/` rules directory lives one level up from the Next.js project
// (repo-root/ai, repo-root/app). Keeping rules outside `app/` means the
// content team can edit them without touching the codebase.
const AI_DIR = path.join(process.cwd(), "..", "ai");

function readAiFile(relativePath: string): string {
  const fullPath = path.join(AI_DIR, relativePath);
  try {
    return fs.readFileSync(fullPath, "utf-8").trim();
  } catch {
    throw new Error(`規則檔讀取失敗: ${relativePath} (expected at ${fullPath})`);
  }
}

export interface DepartmentContext {
  coreRules: string;
  departmentRules: string;
  knowledge: string;
}

/** Loads and composes the core + department rules that govern one assistant. */
export function loadDepartmentContext(departmentId: DepartmentId): DepartmentContext {
  const department = DEPARTMENTS[departmentId];
  return {
    coreRules: readAiFile("core_rules.md"),
    departmentRules: readAiFile(department.rulesPath),
    knowledge: readAiFile(department.knowledgePath),
  };
}

/**
 * Composes the full system prompt an LLM call would use. Not invoked yet
 * (see lib/assistant.ts), but kept here so wiring up a real model later is
 * a one-line change rather than a redesign.
 */
export function buildSystemPrompt(departmentId: DepartmentId): string {
  const { coreRules, departmentRules, knowledge } = loadDepartmentContext(departmentId);
  const department = DEPARTMENTS[departmentId];
  return [
    coreRules,
    `---\n\n# ${department.name} 部門規則\n\n${departmentRules}`,
    `---\n\n# ${department.name} Knowledge Base\n\n${knowledge}`,
  ].join("\n\n");
}
