import { Alert } from "@heroui/react";

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
