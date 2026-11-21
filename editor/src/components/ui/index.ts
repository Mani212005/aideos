/**
 * File Description: Barrel export for the Aideos editor UI primitives.
 * Every editor screen imports its controls from here so the design system stays a single owned
 * surface rather than ad-hoc utility classes scattered across components.
 * Inputs and outputs: UI primitive modules -> centralized barrel export of UI components.
 * Used by: editor screens, inspectors, and modals.
 */

export { cn } from "./cn";
export { Button, type ButtonProps, type ButtonTone, type ButtonSize } from "./Button";
export {
  Panel,
  PanelHeader,
  PanelBody,
  Card,
  type PanelProps,
  type PanelTone,
  type PanelHeaderProps,
  type PanelBodyProps,
  type CardProps,
} from "./Panel";
export {
  Field,
  Input,
  Textarea,
  Select,
  Range,
  NumberStepper,
  type FieldProps,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type RangeProps,
  type NumberStepperProps,
} from "./Field";
export { Badge, Stat, KeyHint, type BadgeProps, type BadgeTone, type StatProps, type KeyHintProps } from "./Badge";
export { Modal, type ModalProps } from "./Modal";
export { SegmentedTabs, type SegmentedTabItem, type SegmentedTabsProps } from "./Tabs";
export {
  EmptyState,
  Note,
  ProgressBar,
  Spinner,
  IconToggle,
  ToastStack,
  type EmptyStateProps,
  type NoteProps,
  type NoteTone,
  type ProgressBarProps,
  type IconToggleProps,
  type ToastMessage,
  type ToastStackProps,
} from "./Feedback";
export {
  Toolbar,
  ToolbarGroup,
  ToolbarDivider,
  ToolbarLabel,
  type ToolbarProps,
  type ToolbarGroupProps,
  type ToolbarDividerProps,
} from "./Toolbar";
export { Waveform, type WaveformProps } from "./Waveform";
