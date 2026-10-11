/** Picker lists for the chat header menu: models, permission modes, effort levels. */
export interface Option {
  value: string;
  label: string;
}

export const MODEL_OPTIONS: Option[] = [
  { value: 'claude-fable-5-1', label: 'claude-fable-5-1' },
  { value: 'claude-opus-5-5', label: 'claude-opus-5-5' },
  { value: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5' },
  { value: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
];

export const PERMISSION_MODE_OPTIONS: Option[] = [
  { value: 'default', label: 'default' },
  { value: 'acceptEdits', label: 'acceptEdits' },
  { value: 'plan', label: 'plan' },
  { value: 'auto', label: 'auto' },
];

export const EFFORT_OPTIONS: Option[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
];
