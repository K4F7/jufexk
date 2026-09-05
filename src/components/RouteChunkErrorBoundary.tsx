import { Alert, Button } from "@heroui/react";
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class RouteChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  retry = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <Alert className="mx-auto my-8 max-w-xl" role="alert" status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>页面组件加载失败</Alert.Title>
          <Alert.Description>请重试一次；如果仍然失败，请检查网络后刷新页面。</Alert.Description>
          <Button className="mt-3" size="sm" variant="primary" onPress={this.retry}>
            重试
          </Button>
        </Alert.Content>
      </Alert>
    );
  }
}
