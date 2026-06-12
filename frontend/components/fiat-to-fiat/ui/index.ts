/**
 * fiat-to-fiat UI kit (§3) — presentational primitives barrel. Every export
 * here is a pure component (props in → JSX out, no useState/wagmi/localStorage),
 * theme-tokens only, honoring prefers-reduced-motion via the theme's global
 * CssBaseline rule. Screens compose these; the shell wires them to the hook.
 */
export { FlowCard, Surface } from "./Surface";
export { PrimaryButton, SecondaryButton, GhostButton, DangerButton } from "./Button";
export { Field } from "./Field";
export { MoneyInput } from "./MoneyInput";
export { PlatformSelect } from "./PlatformSelect";
export { ProviderGlyph, FlowChevron, FlowArrow } from "./ProviderGlyph";
export { PhaseStepper } from "./PhaseStepper";
export { TransferSummaryRail } from "./TransferSummaryRail";
export { CountdownRing, CountdownPill } from "./CountdownRing";
export { StatusScreen } from "./StatusScreen";
export { MakerCard } from "./MakerCard";
export { PaymentRow } from "./PaymentRow";
export { NoticeBanner } from "./Notice";
export { RiskGate } from "./RiskAckChecklist";
export { DoDontList } from "./DoDontList";
export { SummaryRow, SummaryGroup } from "./SummaryRow";
export { StepRow, Stepper, NodeStepper, type StepStatus } from "./StepRow";
export { SuccessCheck } from "./SuccessCheck";
export { phaseIndex, phaseOfFour, phaseLabel, PHASE_LABELS } from "./phases";
export { maskIban, groupIban } from "./format";
