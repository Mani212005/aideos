# Look Brief: Speculative Decoding (designed) (`speculative-decoding-designed`)

Every explainer video gets a written look plan before any visual assets or animation clips are created.
Write `videos/speculative-decoding-designed/design/look.json` and run `aideos look check speculative-decoding-designed` until it reports PASS.

## The 6 Look Questions to Answer

1. **What is the stage?**
   One sentence naming the world the whole film lives in. Every new explainer is a scene film on one persistent 2D spatial canvas. Never clear or jump between disconnected stages.
2. **What carries over?**
   A cast list of named objects. For each: what it is, when it enters, and how it transforms across beats.
   *Important*: carry-over changes must be visibly obvious (magnitude "moderate" or "major"). Minor or imperceptible changes break continuity.
3. **The camera.**
   Must start wide (establishing view) and end wide (payoff view), with slow, purposeful moves (at most 20% frame width per second) in between.
4. **The palette.**
   Background (e.g. `#0A0A0B`), ink/text, the film's one primary accent (e.g. `#635BFF`), and optional labeled semantic colours.
5. **Captions.**
   Burned-in at the bottom band (`position: "bottom"`, `kineticColumn: false`). Never use kinetic text columns over the artwork.
6. **Headlines.**
   Headline cards over the stage (`"none"`, `"few"`, or `"all"`). Prefer `"none"` so the stage carries the story.

## Shot Treatment Decision Rules

For each shot, pick exactly one treatment:
- **`scene`** (Default): the stage moves; a carried object demonstrates what the narration says.
- **`scene+card`**: the stage stays visible with slow motion; a short text card sits over it.
- **`device`**: an inset template device (StatCounter, Plot, TokenStrip, MatrixGrid, CodeBlock) shown over the stage while the stage remains visible. Rules:
  - Allowed only for exact numbers, token streams, or code.
  - No two `device` shots in a row.
  - Limit: at most 1 `device` shot per 4 shots.
- **`footage`**: RESERVED. The checker will reject this.

## Look Plan Schema (look.json)

```json
{
  "schema": "aideos.look/1",
  "decidedBy": {
    "agent": "claude",
    "model": "claude-sonnet-5-5",
    "at": "2026-10-11T12:00:00Z",
    "how": "designed from script beats"
  },
  "film": {
    "mode": "scene",
    "stage": "One server rack seen from the front; data are tiles that move between shelves.",
    "cast": [
      {
        "id": "disk",
        "what": "slow disk on the bottom shelf",
        "enters": "beat-01",
        "changes": [
          {
            "at": "beat-03",
            "how": "dims and slides left as the cache takes over",
            "magnitude": "moderate"
          }
        ]
      },
      {
        "id": "cache",
        "what": "small fast box near the program",
        "enters": "beat-02",
        "changes": [
          {
            "at": "beat-05",
            "how": "becomes the cache card in the final flowchart",
            "magnitude": "major"
          }
        ]
      }
    ],
    "camera": [
      {
        "at": "beat-01",
        "pose": "wide, establishing the server rack",
        "why": "show the whole rack"
      },
      {
        "at": "beat-02",
        "pose": "push in to disk and memory bus",
        "why": "focus on the slow read"
      },
      {
        "at": "beat-06",
        "pose": "wide payoff showing the full data path",
        "why": "payoff shows the whole path"
      }
    ],
    "palette": {
      "bg": "#0A0A0B",
      "accent": "#635BFF",
      "extra": {
        "#3DDC97": "cached data"
      }
    },
    "captions": {
      "position": "bottom",
      "kineticColumn": false
    },
    "headlines": "none"
  },
  "shots": [
    {
      "id": "beat-01",
      "treatment": "scene",
      "carries": [
        "disk"
      ],
      "cue": "spinning",
      "criterion": "1-mechanism",
      "why": "the disk spinning is the claim"
    },
    {
      "id": "beat-04",
      "treatment": "device",
      "device": "StatCounter",
      "carries": [
        "disk",
        "cache"
      ],
      "cue": "faster",
      "criterion": "3-precise-number",
      "why": "the narrator says 100 times faster"
    }
  ],
  "approval": {
    "captain": null
  }
}
```

## Script Beats

- `beat-01` (0:00-0:06, 6.3s, chapter "The Waiting Problem")
  - says: Ask a large language model a question, and watch the answer arrive. It does not appear. It trickles.
  - direction: B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.
- `beat-02` (0:06-0:12, 6.1s, chapter "The Waiting Problem")
  - says: One word, then the next, then the next, at a pace that has almost nothing to do with how much compute you own.
  - direction: B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.
- `beat-03` (0:12-0:20, 7.7s, chapter "The Waiting Problem")
  - says: Here is the part that surprises people. During that trickle, your very expensive accelerator is sitting almost completely idle.
  - direction: B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.
- `beat-04` (0:20-0:31, 11.3s, chapter "Memory, Not Math")
  - says: To produce a single token, the model has to read every one of its weights out of memory. For a seventy billion parameter model, that is well over a hundred gigabytes moved, for one word.
- `beat-05` (0:31-0:45, 13.8s, chapter "Memory, Not Math")
  - says: The arithmetic itself is trivial by comparison. The chip finishes the math in a small fraction of the time, and then it waits. And then it waits again, for the next word, and the one after that, for as long as the answer runs.
- `beat-06` (0:45-0:56, 10.4s, chapter "Memory, Not Math")
  - says: Which leads somewhere strange. Reading those weights costs the same whether you use them to compute one token or a hundred. The bottleneck is the trip, not the cargo.
- `beat-07` (0:56-1:02, 6.6s, chapter "The Asymmetry")
  - says: That asymmetry is the whole trick. Generating a word is slow, because each one depends on the one before it.
- `beat-08` (1:02-1:10, 7.7s, chapter "The Asymmetry")
  - says: Checking a word is fast, because a whole batch of them can be examined in a single pass, using weights you were going to load anyway.
- `beat-09` (1:10-1:19, 8.8s, chapter "The Asymmetry")
  - says: So here is the move. Instead of asking the expensive model to write the answer, we are going to ask it to grade one that somebody else already wrote.
  - direction: The camera pulls back across the canvas so the whole argument so far is visible at once.
- `beat-10` (1:19-1:24, 5.6s, chapter "The Draft Model")
  - says: Alongside the large model, we run a small one. Maybe twenty times smaller, and far quicker.
  - direction: B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.
- `beat-11` (1:24-1:35, 10.8s, chapter "The Draft Model")
  - says: Most of what any model writes is not actually hard. Articles, prepositions, the second half of a common phrase. The small model gets those right almost every time.
  - direction: B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.
- `beat-12` (1:35-1:45, 9.8s, chapter "The Draft Model")
  - says: So it runs ahead and drafts the next handful of tokens by itself. Five words, guessed cheaply, in the time the large model would have spent on part of one.
  - direction: B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.
- `beat-13` (1:45-1:56, 10.7s, chapter "One Pass, Many Checks")
  - says: Now the large model reads all five drafted tokens in a single forward pass. One trip to memory. One set of weights loaded. Five predictions checked in parallel.
- `beat-14` (1:56-2:00, 4.0s, chapter "One Pass, Many Checks")
  - says: It compares each drafted token against what it would have chosen itself.
  - direction: B-roll: five thin parallel beams of violet light sweeping across a dark polished surface in unison.
- `beat-15` (2:00-2:06, 6.1s, chapter "One Pass, Many Checks")
  - says: Everything from the beginning of the draft up to the first disagreement is accepted and kept, in one go.
  - direction: B-roll: five thin parallel beams of violet light sweeping across a dark polished surface in unison.
- `beat-16` (2:06-2:18, 12.0s, chapter "Exactly the Same Answer")
  - says: At that first disagreement, the large model supplies the correct token itself, drawn from a carefully corrected distribution. Nothing is quietly dropped, and nothing is silently approximated.
- `beat-17` (2:18-2:22, 4.2s, chapter "Exactly the Same Answer")
  - says: That is what makes speculative decoding unusual among speed-ups.
  - direction: B-roll: two sheets of clear glass sliding into perfect alignment, thin violet rim light along the edges.
- `beat-18` (2:22-2:29, 7.5s, chapter "Exactly the Same Answer")
  - says: The text you get out is sampled from exactly the same distribution as the slow path. Bit for bit, it is the same model.
  - direction: B-roll: two sheets of clear glass sliding into perfect alignment, thin violet rim light along the edges.
- `beat-19` (2:29-2:44, 14.9s, chapter "What It Buys")
  - says: In practice, on ordinary prose, the draft is accepted often enough to deliver two to three times the throughput. No retraining, no quantisation, no loss of quality. You are simply using the memory bandwidth you were already paying for.
- `beat-20` (2:44-2:55, 10.9s, chapter "What It Buys")
  - says: On dense or unpredictable text, more of the draft gets rejected, and the gain shrinks toward nothing. The speed-up is really a bet on how predictable your output is.
- `beat-21` (2:55-3:08, 13.2s, chapter "What It Buys")
  - says: Which is the lesson hiding underneath all of it. The wait was never the arithmetic. It was the walk to memory. And once you see that, the fix stops looking like a trick, and starts looking obvious: make every walk carry more.

## Commands

- Check the look plan: `aideos look check speculative-decoding-designed`
- Render the human-readable plan: `aideos look check speculative-decoding-designed` automatically generates `design/LOOK.md` on PASS.
