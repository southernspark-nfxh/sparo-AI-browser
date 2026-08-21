/**
 * Universal page analyzer types — 「万能题库」
 * @see NOTICE_sparo-universal-analyzer.md
 */

export type PrimitiveKind =
  | "text_input"
  | "rich_text"
  | "number_input"
  | "password"
  | "search"
  | "tag_input"
  | "date_input"
  | "radio"
  | "checkbox"
  | "select"
  | "toggle"
  | "card_select"
  | "file_upload"
  | "button"
  | "link"
  | "unknown";

export type PageType =
  | "form"
  | "list"
  | "detail"
  | "publish"
  | "chooser"
  | "custom"
  | "unknown";

export type AnalyzedField = {
  ref: string;
  primitive: PrimitiveKind;
  label: string;
  required: boolean;
  required_marker?: string | null;
  placeholder?: string;
  max_length?: number | null;
  current_value?: string;
  tag?: string;
  type?: string;
  name?: string;
  suggested_tags?: string[];
  selector?: string;
  disabled?: boolean;
};

export type AnalyzedButton = {
  ref: string;
  label: string;
  action: "submit" | "save_draft" | "next" | "cancel" | "other";
  disabled?: boolean;
};

export type AnalyzedAlert = {
  type: "toast" | "error" | "warning" | "info";
  message: string;
};

export type AnalyzedPage = {
  ok: true;
  url: string;
  title: string;
  host: string;
  page_type: PageType;
  required_fields: AnalyzedField[];
  optional_fields: AnalyzedField[];
  buttons: AnalyzedButton[];
  alerts: AnalyzedAlert[];
  field_count: number;
  capturedAt: string;
};

export type PrimitivePlanStep = {
  key: string;
  ref: string;
  primitive: PrimitiveKind;
  label: string;
  value: unknown;
  method: string;
  fallback: string[];
  required: boolean;
};

export type PrimitiveStepResult = {
  key: string;
  ref: string;
  primitive: PrimitiveKind;
  ok: boolean;
  method: string;
  attempts: number;
  message: string;
  qa?: { expected?: string; actual?: string; matched?: boolean };
  learned?: boolean;
};

export type ExecutePrimitivesResult = {
  ok: boolean;
  url: string;
  host: string;
  plan: PrimitivePlanStep[];
  steps: PrimitiveStepResult[];
  unmatchedKeys: string[];
  missingRequired: string[];
  finalQa: { ok: boolean; emptyRequired: string[] };
  message: string;
};
