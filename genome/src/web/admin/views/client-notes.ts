/**
 * The client sheet's Tags and private notes (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.3, C.9, C.11, step 5.6):
 * what ORBES Client Services keeps about a client, never shown to the client.
 *   - Tags: in capitals, each with its × for an OPERATOR or an ADMIN; Add a tag with the tags in use suggested (the most
 *     used first; VIP, PRESS and FRIEND OF THE HOUSE while none is used), at most 20 a client.
 *   - Private notes: Add a private note at the top (2,000 characters, a counter near the end), then the notes, the newest
 *     first, each with when and who wrote it and Remove for its writer or an ADMIN (asked first); the 50 newest, then
 *     « Show the … older notes ». A note is never edited: a correction is a new note.
 * An AUDITOR reads both, without the controls; nothing is written on a DELETED account. Each write changes the section
 * in place (the rest of the sheet is not read again). The words are model/client-notes.ts.
 */
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  canRemoveNote,
  NOTE_MAX,
  noteCounter,
  noteLine,
  noteProblem,
  olderNotesLabel,
  removeTagLabel,
  TAGS_NOTES_COPY as T,
  tagProblem,
  tagSuggestionsFor,
  tagValue,
} from '../model/client-notes.js';
import { can } from '../model/permissions.js';
import type { OwnerSheet, PrivateNote } from '../types.js';
import { button, busy, input, section, statusMark, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

let listSeq = 0;

/** The Tags and private notes section, after the Profile (C.4.1). */
export function tagsNotesSection(ctx: ViewContext, sheet: OwnerSheet): HTMLElement {
  const accountId = sheet.owner.id;
  const me = { id: ctx.session.admin.id, role: ctx.session.admin.role };
  const writable = sheet.owner.status !== 'DELETED';
  const canTag = can(me.role, 'tagClients') && writable;
  const canWrite = can(me.role, 'writeClientNotes') && writable;

  // ── Tags ──
  let tags = [...sheet.tags];
  let suggestions: string[] = [];
  const tagLine = h('div', { class: 'client-tags', data: { testid: 'client-tags' } });
  const listId = `client-tag-list-${++listSeq}`;
  const datalist = h('datalist', { attrs: { id: listId } });
  const drawSuggestions = () => mount(datalist, ...tagSuggestionsFor(suggestions.map((tag) => ({ tag, accounts: 0 })), tags).map((t) => h('option', { attrs: { value: t } })));
  const drawTags = () => {
    mount(
      tagLine,
      ...(tags.length === 0
        ? [h('p', { class: 'soft' }, T.noTag)]
        : tags.map((tag) =>
            h(
              'span',
              { class: 'client-tag', data: { testid: 'client-tag' } },
              statusMark(tag, 'outline'),
              canTag ? h('button', { class: 'client-tag__remove', attrs: { type: 'button', 'aria-label': removeTagLabel(tag), 'data-testid': 'client-tag-remove' }, on: { click: () => void removeTag(tag) } }, '×') : null,
            ),
          )),
    );
    drawSuggestions();
  };
  const removeTag = async (tag: string) => {
    try {
      await ctx.api.removeClientTag(accountId, tag);
      const at = tags.indexOf(tag);
      tags = tags.filter((t) => t !== tag);
      drawTags();
      // The × that had the focus is gone: the focus goes to the × now at its place, else the one before, else Add a tag.
      const xs = tagLine.querySelectorAll<HTMLButtonElement>('.client-tag__remove');
      (xs[Math.min(Math.max(at, 0), xs.length - 1)] ?? tagInput).focus();
      notify(T.tagRemoved);
    } catch (e) {
      notifyError(e);
    }
  };
  const tagInput = input('tag', { maxlength: 64, autocomplete: 'off', placeholder: T.addTag });
  tagInput.setAttribute('list', listId);
  tagInput.setAttribute('aria-label', T.addTag);
  tagInput.setAttribute('data-testid', 'client-tag-input');
  const tagError = h('p', { class: 'client-notes__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const addTag = button(T.add, { kind: 'secondary', testId: 'client-tag-add' });
  const submitTag = async () => {
    tagError.textContent = '';
    const problem = tagProblem(tagInput.value, tags);
    if (problem) {
      tagError.textContent = problem;
      tagInput.focus();
      return;
    }
    try {
      const r = await busy(addTag, () => ctx.api.addClientTag(accountId, tagValue(tagInput.value)), T.adding);
      tags = r.tags;
      tagInput.value = '';
      drawTags();
      notify(T.tagAdded);
    } catch (e) {
      tagError.textContent = e instanceof ApiError ? e.message : T.tagRefused;
    }
  };
  addTag.addEventListener('click', () => void submitTag());
  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void submitTag();
    }
  });
  if (canTag) {
    ctx.api.tagSuggestions().then(
      (r) => {
        suggestions = r.items.map((x) => x.tag);
        drawSuggestions();
      },
      () => {
        /* typed blind: the field still works */
      },
    );
  }
  drawTags();

  // ── Private notes ──
  let notes: PrivateNote[] = [...sheet.privateNotes.items];
  let total = sheet.privateNotes.total;
  const noteList = h('div', { class: 'client-notes', data: { testid: 'client-notes' } });
  const drawNotes = () => {
    const more = olderNotesLabel(total, notes.length);
    const showAll = more
      ? button(more, {
          kind: 'ghost',
          testId: 'client-notes-more',
          onClick: () =>
            void ctx.api.clientNotes(accountId).then((r) => {
              notes = r.items;
              total = r.total;
              drawNotes();
            }, notifyError),
        })
      : null;
    mount(
      noteList,
      ...(notes.length === 0
        ? [h('p', { class: 'soft' }, T.noNote)]
        : notes.map((n) =>
            h(
              'article',
              { class: 'client-private-note', data: { testid: 'client-private-note' } },
              h('p', { class: 'client-private-note__text' }, n.text),
              h(
                'p',
                { class: 'client-private-note__line' },
                h('span', null, noteLine(n)),
                canRemoveNote(n, me) && writable ? button(T.remove, { kind: 'ghost', testId: 'client-note-remove', onClick: () => void removeNote(n) }) : null,
              ),
            ),
          )),
      showAll,
    );
  };
  const removeNote = async (n: PrivateNote) => {
    const r = await openDialog({
      title: T.removeTitle,
      body: h('p', { class: 'dialog__text' }, T.removeBody),
      confirmLabel: T.remove,
      cancelLabel: T.keep,
      danger: true,
      submit: async () => {
        await ctx.api.removeClientNote(accountId, n.id);
      },
    });
    if (!r) return;
    notes = notes.filter((x) => x.id !== n.id);
    total = Math.max(0, total - 1);
    drawNotes();
    notify(T.noteRemoved);
  };
  const noteText = textarea('text', { rows: 4, maxlength: NOTE_MAX });
  noteText.setAttribute('aria-label', T.addNote);
  noteText.setAttribute('placeholder', T.addNote);
  noteText.setAttribute('data-testid', 'client-note-input');
  const counter = h('span', { class: 'client-notes__counter', attrs: { 'aria-live': 'polite' } });
  const noteError = h('p', { class: 'client-notes__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
  const addNote = button(T.addNoteButton, { kind: 'secondary', testId: 'client-note-add', disabled: true });
  const syncNote = () => {
    counter.textContent = noteCounter(noteText.value);
    addNote.disabled = noteText.value.trim() === '';
  };
  noteText.addEventListener('input', syncNote);
  addNote.addEventListener('click', async () => {
    noteError.textContent = '';
    const problem = noteProblem(noteText.value);
    if (problem) {
      noteError.textContent = problem;
      return;
    }
    try {
      const added = await busy(addNote, () => ctx.api.addClientNote(accountId, noteText.value), T.adding);
      notes = [added, ...notes];
      total += 1;
      noteText.value = '';
      syncNote();
      drawNotes();
      notify(T.noteAdded);
    } catch (e) {
      noteError.textContent = e instanceof ApiError ? e.message : T.noteRefused;
      syncNote();
    }
  });
  drawNotes();

  return section(
    T.title,
    [
      h('h3', { class: 'panel__subtitle' }, T.tags),
      tagLine,
      canTag ? h('div', { class: 'client-tags__add' }, tagInput, datalist, addTag) : null,
      canTag ? tagError : null,
      h('h3', { class: 'panel__subtitle' }, T.notes),
      canWrite ? h('div', { class: 'client-notes__add' }, noteText, h('div', { class: 'client-notes__actions' }, counter, addNote)) : null,
      canWrite ? noteError : null,
      noteList,
    ],
    { id: 'tags-notes', note: T.note },
  );
}
