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
- **Extra Colours**: `#3DDC97`: accepted speculative tokens, `#FF5C5C`: rejected speculative tokens
- **Captions**: Position bottom (kinetic column: no)
- **Headlines**: none

## Shots & Beat Treatments

- 0:00-0:06 `beat-01` **scene** [carries: memory, chip, road]: on "trickles" (the slow single token trickle is established on the road)
- 0:06-0:12 `beat-02` **scene** [carries: memory, chip, road]: on "cannot buy" (tokens crawl across the empty highway)
- 0:12-0:20 `beat-03` **scene** [carries: chip]: on "idle" (chip activity indicator dims down to cold)
- 0:20-0:31 `beat-04` **scene** [carries: memory]: on "weights" (scan line moves across seventy billion parameters)
- 0:31-0:45 `beat-05` **scene** [carries: memory, road]: on "bandwidth" (one word costs a hundred gigabytes of transfer)
- 0:45-0:56 `beat-06` **scene** [carries: memory, chip, road]: on "waiting" (road is quiet while the chip waits)
- 0:56-1:02 `beat-07` **scene** [carries: chip]: on "asymmetry" (checking multiple tokens costs the same memory pass as one)
- 1:02-1:10 `beat-08` **scene** [carries: chip]: on "one pass" (matrix multiplication checks parallel candidates)
- 1:10-1:19 `beat-09` **scene** [carries: draft-model]: on "draft model" (small compact draft model appears above the bus)
- 1:19-1:24 `beat-10` **scene** [carries: draft-model, road]: on "speculative" (draft model emits speculative tokens along the road)
- 1:24-1:35 `beat-11` **scene** [carries: memory, road]: on "cargo" (memory weights are pulled once for all five candidates)
- 1:35-1:45 `beat-12` **scene** [carries: road, chip]: on "train" (candidate train enters accelerator queue)
- 1:45-1:56 `beat-13` **scene** [carries: chip]: on "verification" (parallel verification activates inside chip)
- 1:56-2:00 `beat-14` **scene** [carries: chip]: on "accepted" (first four candidates turn green and get accepted)
- 2:00-2:06 `beat-15` **scene** [carries: road, chip]: on "rejected" (fifth token is replaced seamlessly)
- 2:06-2:18 `beat-16` **scene** [carries: chip]: on "identical" (mathematical guarantee of exact output equality)
- 2:18-2:22 `beat-17` **scene** [carries: chip]: on "distribution" (output distribution matches the original model bit for bit)
- 2:22-2:29 `beat-18` **scene** [carries: chip]: on "same model" (no drift and no quality degradation)
- 2:29-2:44 `beat-19` **device** (StatCounter) [carries: road, chip]: on "times faster" (narrator explicitly cites two to three times throughput)
- 2:44-2:55 `beat-20` **scene** [carries: road, chip]: on "predictable" (acceptance rate depends on entropy of text)
- 2:55-3:08 `beat-21` **scene** [carries: memory, chip, road]: on "carry more" (wide bus road is filled with cargo for maximum efficiency)
