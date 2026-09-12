export type DepartmentId = "hr" | "sales";

export interface Department {
  id: DepartmentId;
  name: string;
  tagline: string;
  /** Paths are relative to the repo-root `ai/` directory. */
  rulesPath: string;
  knowledgePath: string;
  suggestedPrompts: string[];
}

export const DEPARTMENTS: Record<DepartmentId, Department> = {
  hr: {
    id: "hr",
    name: "HR Assistant",
    tagline: "請假制度、員工福利、新人報到",
    rulesPath: "hr/rules.md",
    knowledgePath: "hr/knowledge.md",
    suggestedPrompts: [
      "特休怎麼算?",
      "新人報到要準備什麼?",
      "有哪些員工福利?",
    ],
  },
  sales: {
    id: "sales",
    name: "Sales Assistant",
    tagline: "產品資訊、客戶需求分析、銷售流程",
    rulesPath: "sales/rules.md",
    knowledgePath: "sales/knowledge.md",
    suggestedPrompts: [
      "GX35 和 GX50 差在哪?",
      "客戶果園有病蟲害問題,該推薦什麼產品?",
      "銷售流程是什麼?",
    ],
  },
};

export const DEPARTMENT_LIST = Object.values(DEPARTMENTS);

export function isDepartmentId(value: string): value is DepartmentId {
  return value === "hr" || value === "sales";
}
