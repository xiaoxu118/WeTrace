/** System task prompts are read-only; user styles only configure presentation. */
export interface AiPromptSettings { query: string; answer: string }
export type AiPromptStyleId = string
export interface AiPromptStyle { id: string; name: string; prompt: string }
export interface SaveAiPromptsInput { selectedStyleId: string; styles: AiPromptStyle[] }
export interface AiPromptSettingsResponse {
  current: AiPromptSettings
  defaults: AiPromptSettings
  selectedStyleId: string
  styles: AiPromptStyle[]
  defaultStylePrompt: string
}
