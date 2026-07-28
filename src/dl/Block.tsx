import React from "react";
import type { Block } from "./schema";
import {
  Body,
  Card,
  Divider,
  IconLabel,
  Kicker,
  MathLine,
  Plot,
  ProgressBar,
  StatCounter,
  TextReveal,
  type BlockProps,
} from "./primitives";
import {
  AnalogyInset,
  AttentionArcs,
  Distribution,
  LayerStack,
  MatrixGrid,
  ScaleBar,
  TokenStrip,
  VectorSpace,
} from "./devices";

/**
 * The one place that maps schema to component.
 *
 * The union is exhaustive and TypeScript enforces it, so adding a block to
 * `blockSchema` without building it is a compile error rather than a silently
 * empty frame at minute nine of a render.
 */
export const BlockView: React.FC<{ block: Block } & BlockProps> = ({ block, ...timing }) => {
  switch (block.c) {
    case "Kicker":
      return <Kicker {...timing} text={block.text} />;
    case "TextReveal":
      return (
        <TextReveal {...timing} text={block.text} size={block.size} accentWord={block.accentWord} />
      );
    case "Body":
      return <Body {...timing} text={block.text} />;
    case "Math":
      return <MathLine {...timing} text={block.text} />;
    case "StatCounter":
      return (
        <StatCounter
          {...timing}
          to={block.to}
          label={block.label}
          format={block.format}
          suffix={block.suffix}
        />
      );
    case "ProgressBar":
      return (
        <ProgressBar {...timing} value={block.value} label={block.label} chapters={block.chapters} />
      );
    case "Plot":
      return (
        <Plot
          {...timing}
          points={block.points}
          xLabel={block.xLabel}
          yLabel={block.yLabel}
          endLabel={block.endLabel}
        />
      );
    case "MatrixGrid":
      return (
        <MatrixGrid
          {...timing}
          values={block.values}
          rowLabel={block.rowLabel}
          colLabel={block.colLabel}
          valueLabel={block.valueLabel}
          sweep={block.sweep}
        />
      );
    case "Distribution":
      return (
        <Distribution {...timing} prompt={block.prompt} items={block.items} note={block.note} />
      );
    case "TokenStrip":
      return (
        <TokenStrip {...timing} tokens={block.tokens} lit={block.lit} caption={block.caption} />
      );
    case "AttentionArcs":
      return (
        <AttentionArcs
          {...timing}
          tokens={block.tokens}
          focus={block.focus}
          links={block.links}
          note={block.note}
        />
      );
    case "VectorSpace":
      return (
        <VectorSpace
          {...timing}
          points={block.points}
          arrow={block.arrow}
          xLabel={block.xLabel}
          yLabel={block.yLabel}
        />
      );
    case "LayerStack":
      return (
        <LayerStack
          {...timing}
          count={block.count}
          bottomLabel={block.bottomLabel}
          topLabel={block.topLabel}
        />
      );
    case "ScaleBar":
      return <ScaleBar {...timing} ticks={block.ticks} value={block.value} label={block.label} />;
    case "AnalogyInset":
      return <AnalogyInset {...timing} caption={block.caption} src={block.src} />;
    case "Card":
      return <Card {...timing} title={block.title} body={block.body} state={block.state} />;
    case "Divider":
      return <Divider {...timing} />;
    case "IconLabel":
      return <IconLabel {...timing} text={block.text} />;
  }
};
