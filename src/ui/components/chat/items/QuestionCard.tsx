/**
 * An AskUserQuestion request: each question with its options as toggle buttons (one or many) and
 * an Other field whose text is the answer verbatim. Send answers unlocks when every question has
 * one; a tap disables the card and spins the button until the store confirms (or ten seconds).
 * Every option renders at its full height; nothing in the card is clipped.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { QuestionItem } from '../../../../core/types';
import { Button } from '../../common/Button';
import { Icon } from '../../common/Icon';
import { Spinner } from '../../common/Spinner';
import { useBusy } from './busy';

export interface QuestionCardProps {
  item: QuestionItem;
  cooking: boolean;
  onSubmit: (answers: Record<string, string | string[]>, response?: string) => void | Promise<unknown>;
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
  const busy = useBusy();
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
  const waiting = busy.key !== null;

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
    <div class={`claudsidian-question ${p.cooking ? 'is-cooking' : ''} ${waiting ? 'is-busy' : ''}`} role="group" aria-labelledby={`${item.id}-kicker`}>
      <div class="claudsidian-perm-head">
        <Icon name="message-circle-question" size="small" />
        <span class="claudsidian-perm-kicker" id={`${item.id}-kicker`}>
          Claude asks
        </span>
      </div>
      {item.questions.map((q, i) => {
        const draft = drafts[i];
        const textId = `${item.id}-q${i}`;
        return (
          <div class="claudsidian-question-block" key={i}>
            {q.header ? <div class="claudsidian-question-header">{q.header}</div> : null}
            <div class="claudsidian-question-text" id={textId}>
              {q.question}
            </div>
            <div class="claudsidian-question-options" role="group" aria-labelledby={textId}>
              {q.options.map((o) => {
                const on = draft?.picked.includes(o.label) ?? false;
                return (
                  <button
                    type="button"
                    key={o.label}
                    class={`claudsidian-option ${on ? 'is-on' : ''}`}
                    aria-pressed={on ? 'true' : 'false'}
                    disabled={waiting}
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
                disabled={waiting}
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
        <Button kind="primary" disabled={!complete || waiting} onClick={() => busy.run('submit', () => p.onSubmit(answers))}>
          {busy.key === 'submit' ? <Spinner size="small" label="Sending" /> : null}
          <span class="claudsidian-btn-label">Send answers</span>
        </Button>
      </div>
    </div>
  );
}
