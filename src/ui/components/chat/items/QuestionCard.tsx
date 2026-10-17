/**
 * An AskUserQuestion request: each question with its options as toggle buttons (one or many) and
 * an Other field whose text is the answer verbatim. A card with one single-select question answers
 * on the first tap (one hand in the kitchen); its Other field sends on Enter or its Send button.
 * Multi-select and multi-question cards keep "Send answers", which unlocks when every question has
 * one. Sending disables the card and spins until the store confirms (or ten seconds). Every option
 * renders at its full height; nothing in the card is clipped.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
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
  // A second tap can land before the busy state paints; only the first one picks and sends.
  const tapped = useRef(false);
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
  const single = item.questions.length === 1 && item.questions[0]?.multiSelect === false;
  const submit = (key: string, a: Record<string, string>): void => {
    busy.run(key, async () => {
      try {
        await p.onSubmit(a);
      } finally {
        tapped.current = false;
      }
    });
  };

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
                    onClick={() => {
                      if (!single) return toggle(i, o.label, q.multiSelect);
                      if (tapped.current || waiting) return;
                      tapped.current = true;
                      update(i, (d) => ({ ...d, picked: [o.label] }));
                      submit(`option:${o.label}`, { [q.question]: o.label });
                    }}
                  >
                    {busy.key === `option:${o.label}` ? <Spinner size="small" label="Sending" /> : null}
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
                onKeyDown={(ev) => {
                  if (!single || ev.key !== 'Enter' || ev.isComposing) return;
                  const other = (draft?.other ?? '').trim();
                  if (!other || waiting) return;
                  ev.preventDefault();
                  submit('submit', { [q.question]: other });
                }}
              />
            </label>
          </div>
        );
      })}
      {single && !(drafts[0]?.other.trim() ?? '') ? null : (
        <div class="claudsidian-perm-actions">
          <Button kind="primary" disabled={!complete || waiting} onClick={() => submit('submit', single ? { [item.questions[0]?.question ?? '']: drafts[0]?.other.trim() ?? '' } : answers)}>
            {busy.key === 'submit' ? <Spinner size="small" label="Sending" /> : null}
            <span class="claudsidian-btn-label">{single ? 'Send' : 'Send answers'}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
