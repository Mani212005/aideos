# Look Plan: Speculative Decoding (designed)

**Decided by**: claude (claude-sonnet-5-5) at 2026-10-11T16:00:00Z - authored for speculative-decoding fixture package

## Stage

A single dark motherboard with a memory bank on the left and an accelerator chip on the right connected by a wide data bus road.

## Cast (Persistent Elements)

| ID | What | Enters | Changes Across Beats |
|---|---|---|---|
| `memory` | high bandwidth memory stack on the left | beat-01 | beat-04: lights up its read scan line as weights are pulled (moderate); beat-11: streams large blocks of weights across the bus road (major) |
| `chip` | accelerator processor die on the right | beat-01 | beat-03: dims its activity indicator to show idle waiting state (moderate); beat-14: runs verification in parallel across multiple candidate tokens (major) |
| `road` | bus lanes between memory and accelerator | beat-01 | beat-05: transports a tiny single-token cargo packet across the wide lanes (moderate); beat-15: fills completely with a train of five speculative tokens (major) |
| `draft-model` | small compact draft model engine above the road | beat-09 | beat-10: rapidly emits five speculative candidate tokens ahead of verification (major) |

## Camera

- **beat-01**: wide establishing view of the memory and accelerator board (establish the physical distance between memory and computation)
- **beat-04**: push in to memory bank (the massive weight transfer bottleneck)
- **beat-10**: pan to draft model above the road (observe fast speculative token generation)
- **beat-14**: push in to the accelerator verification core (single-pass parallel verification of draft candidates)
- **beat-21**: wide payoff showing the full system running at 3x throughput (payoff shows the full path with full bus saturation)

## Palette & Style

- **Background**: `#0A0A0B`
- **Accent**: `#635BFF`
- **Captions**: Position bottom (kinetic column: no)
- **Headlines**: none

## Shots & Beat Treatments

- shot-1 `beat-01` **scene** [carries: memory, chip, road]: on "trickles" (the slow single token trickle is established on the road)
- shot-2 `beat-02` **scene** [carries: memory, chip, road]: on "One word" (tokens crawl across the empty highway)
- shot-3 `beat-03` **scene** [carries: chip]: on "idle" (chip activity indicator dims down to cold)
- shot-4 `beat-04` **scene** [carries: memory]: on "weights" (scan line moves across seventy billion parameters)
- shot-5 `beat-05` **scene** [carries: memory, road]: on "waits again" (one word costs a hundred gigabytes of transfer)
- shot-6 `beat-06` **scene** [carries: memory, chip, road]: on "same whether" (road is quiet while the chip waits)
- shot-7 `beat-07` **scene** [carries: chip]: on "asymmetry" (checking multiple tokens costs the same memory pass as one)
- shot-8 `beat-08` **scene** [carries: chip]: on "single pass" (matrix multiplication checks parallel candidates)
- shot-9 `beat-09` **scene** [carries: draft-model]: on "grade one" (small compact draft model appears above the bus)
- shot-10 `beat-10` **scene** [carries: draft-model, road]: on "small one" (draft model emits speculative tokens along the road)
- shot-11 `beat-11` **scene** [carries: memory, road]: on "those right" (memory weights are pulled once for all five candidates)
- shot-12 `beat-12` **scene** [carries: road, chip]: on "runs ahead" (candidate train enters accelerator queue)
- shot-13 `beat-13` **scene** [carries: chip]: on "five drafted tokens" (parallel verification activates inside chip)
- shot-14 `beat-14` **scene** [carries: chip]: on "compares each" (first four candidates turn green and get accepted)
- shot-15 `beat-15` **scene** [carries: road, chip]: on "first disagreement" (fifth token is replaced seamlessly)
- shot-16 `beat-16` **scene** [carries: chip]: on "correct token" (mathematical guarantee of exact output equality)
- shot-17 `beat-17` **scene** [carries: chip]: on "speed-ups" (output distribution matches the original model bit for bit)
- shot-18 `beat-18` **scene** [carries: chip]: on "same model" (no drift and no quality degradation)
- shot-19 `beat-19` **device** (StatCounter) [carries: road, chip]: on "two to three times" (narrator explicitly cites two to three times throughput)
- shot-20 `beat-20` **scene** [carries: road, chip]: on "predictable" (acceptance rate depends on entropy of text)
- shot-21 `beat-21` **scene** [carries: memory, chip, road]: on "carry more" (wide bus road is filled with cargo for maximum efficiency)
