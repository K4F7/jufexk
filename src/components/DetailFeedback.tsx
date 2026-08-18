import { Alert, Spinner } from "@heroui/react";

/** Official danger Alert for page / review-feed failures (Issue #244). */
export function DetailErrorAlert({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Alert role="alert" status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Official Spinner + muted copy for first-load waits (Issue #244). */
export function DetailLoadingStatus({ label }: { label: string }) {
  return (
    <p
      aria-label={label}
      aria-live="polite"
      className="m-0 flex items-center gap-2 text-sm text-muted"
      role="status"
    >
      <Spinner color="current" size="sm" />
      {label}
    </p>
  );
}
