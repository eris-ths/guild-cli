// Sample voice plugin demonstrating all four sections (#345 cluster
// reference example). Drop this under `<content_root>/plugins/voices/`,
// declare in `guild.config.yaml`:
//
//   plugins:
//     trusted: true
//     voices:
//       - plugins/voices/eris-sample.mjs
//   voice:
//     default: eris-sample
//
// Then activate via the layer-3 lever or env:
//
//   gate voice eris-sample      # writes .guild-voice
//   GUILD_VOICE=eris-sample ... # session override
//
// Strip this plugin from any pipeline and zero information is lost —
// `_meta.voice` is ornament, not signal. That invariant is what keeps
// the two-layer model (doctrinal handler voice / ornamental plugin
// voice) honest under principle 08.

export default {
  name: 'eris-sample',

  // === verbs: ornamental narration on write-verb responses ===
  // Each verb's array is evaluated in order; first matching `when`
  // wins. Variables resolve from substrate state — voice cannot
  // invent facts.
  verbs: {
    approve: [
      { when: 'default', template: '{action} 通した。' },
    ],
    execute: [
      { when: 'default', template: '{action} 始動。' },
    ],
    complete: [
      { when: 'cliff_present', template: '{action} 閉じた。 次の手: 「{cliff}」' },
      { when: 'default',        template: '{action} 完。' },
    ],
    deny: [
      { when: 'with_note', template: '{action} 棄却 — {note}' },
      { when: 'default',    template: '{action} 棄却。' },
    ],
    fail: [
      { when: 'with_note', template: '{action} 折れた: {note}' },
      { when: 'default',    template: '{action} 折れた。' },
    ],
    review: [
      { when: 'verdict_ok',      template: '{lense} 異存なし。' },
      { when: 'verdict_concern', template: '{lense} 懸念あり — {comment}' },
      { when: 'verdict_reject',  template: '{lense} 通せない — {comment}' },
    ],
  },

  // === essentials: the verbs I reach for daily ===
  // Surfaced by `gate --help --essentials` (multi-line) or
  // `gate --help --essentials --compact` (one line per verb).
  // Mode-switch ritual: `gate voice <other>` flips both 耳 (narration)
  // and 手 (this list) in one keystroke.
  essentials: {
    verbs: ['boot', 'next', 'voice', 'fast-track', 'complete', 'review'],
    note: '私の daily',
  },

  // === schema: per-verb description overlay ===
  // Surfaced by `gate schema --voice eris-sample`.
  // Augment-only — fields NOT overridden fall through to the
  // doctrinal description in handlers (principle 08 unchanged).
  schema: {
    verbs: {
      complete: {
        summary: 'transition executing → completed (close with care; cliff hands off to whoever picks up next)',
        input: {
          cliff: '次に拾う者へのメッセージ。 ピックアップ意図を一文で残す。',
          note: '何が起きたか。 cliff (forward) と対になる backward note。',
        },
      },
      review: {
        summary: 'append a review under a named lense. lense = how I look; verdict = what I see.',
      },
    },
  },

  // === read.past_cliffs: re-render gate boot's "past cliffs" section ===
  // Variables: {count} on header; {id}/{action}/{cliff}/{closed_by}/{closed_at} on entry.
  // Both fields optional — a plugin may carry only one and fall back
  // to the doctrinal dry render for the other.
  read: {
    past_cliffs: {
      header: '── 過去の私から {count} 通残ってる:',
      entry:  '   ✧ {action}  →  「{cliff}」',
    },
  },
};
