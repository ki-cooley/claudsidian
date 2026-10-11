/**
 * An AskUserQuestion request: each question with its options as toggle buttons (one or many) and
 * an Other field whose text is the answer verbatim. Send answers unlocks when every question has one.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { QuestionItem } from '../../../../core/types';
import { Button } from '../../common/Button';
import { Icon } from '../../common/Icon';

export interface QuestionCardProps {
  item: QuestionItem;
  cooking: boolean;
  onSubmit: (answers: Record<string, string | string[]>, response?: string) => void;
}

interface Draft {
  picked: string[];
  other: string;
}

/** The answer for one question: Other text wins for single select and joins the picks for multi select. */
export function answerFor(draft: Draft | undefined, multi: boolean): string | undefined {
  if (!draft) return undefined;
  const other = draft.other.trim();
  if (!multi) return other || draft.picked[0];
  const parts = [...draft.picked];
  if (other) parts.push(other);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function QuestionCard(p: QuestionCardProps): JSX.Element {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const { item } = p;

  if (item.resolved) {
    const answers = item.answers ?? {};
    return (
      <div class="claudsidian-question is-resolved">
        <Icon name="check" size="small" />
        <span class="claudsidian-question-resolved-text">
          {item.questions.length > 0
            ? item.questions.map((q, i) => (
                <span key={i} class="claudsidian-question-answer">
                  {q.header ?? q.question}: {String(answers[q.question] ?? 'no answer')}
                </span>
              ))
            : 'Answered'}
        </span>
      </div>
    );
  }

  const answers: Record<string, string> = {};
  let complete = item.questions.length > 0;
  item.questions.forEach((q, i) => {
    const a = answerFor(drafts[i], q.multiSelect);
    if (a === undefined) complete = false;
    else answers[q.question] = a;
  });

  const update = (i: number, fn: (d: Draft) => Draft): void => {
    setDrafts((prev) => ({ ...prev, [i]: fn(prev[i] ?? { picked: [], other: '' }) }));
  };
  const toggle = (i: number, label: string, multi: boolean): void => {
    update(i, (d) => {
      if (!multi) return { ...d, picked: d.picked[0] === label ? [] : [label] };
      return { ...d, picked: d.picked.includes(label) ? d.picked.filter((x) => x !== label) : [...d.picked, label] };
    });
  };

  return (
    <div class={`claudsidian-question ${p.cooking ? 'is-cooking' : ''}`} role="group" aria-label="Question from Claude">
      <div class="claudsidian-perm-head">
        <Icon name="message-circle-question" size="small" />
        <span class="claudsidian-perm-kicker">Claude asks</span>
      </div>
      {item.questions.map((q, i) => {
        const draft = drafts[i];
        return (
          <div class="claudsidian-question-block" key={i}>
            {q.header ? <div class="claudsidian-question-header">{q.header}</div> : null}
            <div class="claudsidian-question-text">{q.question}</div>
            <div class="claudsidian-question-options" role="group" aria-label={q.question}>
              {q.options.map((o) => {
                const on = draft?.picked.includes(o.label) ?? false;
                return (
                  <button
                    type="button"
                    key={o.label}
                    class={`claudsidian-option ${on ? 'is-on' : ''}`}
                    aria-pressed={on ? 'true' : 'false'}
                    onClick={() => toggle(i, o.label, q.multiSelect)}
                  >
                    <span class="claudsidian-option-label">{o.label}</span>
                    {o.description ? <span class="claudsidian-option-desc">{o.description}</span> : null}
                  </button>
                );
              })}
            </div>
            <label class="claudsidian-question-other">
              <span class="claudsidian-question-other-label">Other</span>
              <input
                type="text"
                placeholder={q.multiSelect ? 'Add your own' : 'Type your own answer'}
                value={draft?.other ?? ''}
                onInput={(ev) => {
                  const value = (ev.currentTarget as HTMLInputElement).value;
                  update(i, (d) => ({ ...d, other: value }));
                }}
              />
            </label>
          </div>
        );
      })}
      <div class="claudsidian-perm-actions">
        <Button label="Send answers" kind="primary" disabled={!complete} onClick={() => p.onSubmit(answers)} />
      </div>
    </div>
  );
}
